//! Live turn input shares the driver's stdout reader, so steering never steals
//! a notification or blocks the existing stream while awaiting its RPC reply.
use super::{
    build_turn_input, find_native_skill_input, jsonrpc_error_message, send_jsonrpc,
    CodexChatAttachment, CodexSelectedSkill, NativeSkillInput,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use tokio::io::AsyncWrite;
use tokio::sync::{mpsc, oneshot};

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteerRequest {
    pub run_id: String,
    pub conversation_id: String,
    pub message_id: String,
    pub prompt: String,
    pub selected_skill: Option<CodexSelectedSkill>,
    pub attachments: Option<Vec<CodexChatAttachment>>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct SteerResult {
    pub accepted: bool,
}

pub struct SteerCommand {
    pub request: SteerRequest,
    pub reply: oneshot::Sender<Result<SteerResult, String>>,
}

#[derive(Clone)]
pub struct SteerSession {
    pub module_identity: Option<super::agent_network::RelayConfig>,
    pub conversation_id: String,
    pub sender: mpsc::Sender<SteerCommand>,
}

enum Pending {
    Skills(SteerCommand),
    Steer(SteerCommand),
}

pub struct Steering {
    pub receiver: mpsc::Receiver<SteerCommand>,
    pub turn_id: Option<String>,
    next_id: u64,
    pending: HashMap<u64, Pending>,
}

impl Steering {
    pub fn new(receiver: mpsc::Receiver<SteerCommand>) -> Self {
        Self {
            receiver,
            turn_id: None,
            next_id: 100,
            pending: HashMap::new(),
        }
    }

    fn request_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub async fn submit<W: AsyncWrite + Unpin>(
        &mut self,
        stdin: &mut W,
        command: SteerCommand,
        thread_id: &str,
        cwd: &str,
    ) -> Result<(), String> {
        if command.reply.is_closed() {
            return Ok(());
        }
        if command.request.selected_skill.is_some() {
            let id = self.request_id();
            self.pending.insert(id, Pending::Skills(command));
            send_jsonrpc(
                stdin,
                &json!({"jsonrpc":"2.0", "id":id,
                "method":"skills/list", "params":{"cwds":[cwd], "forceReload":false}}),
            )
            .await
        } else {
            self.send_input(stdin, command, thread_id, None).await
        }
    }

    async fn send_input<W: AsyncWrite + Unpin>(
        &mut self,
        stdin: &mut W,
        command: SteerCommand,
        thread_id: &str,
        skill: Option<&NativeSkillInput>,
    ) -> Result<(), String> {
        let id = self.request_id();
        let request = &command.request;
        let input = build_turn_input(
            &request.prompt,
            request.attachments.as_deref().unwrap_or_default(),
            skill,
        );
        let rpc = json!({"jsonrpc":"2.0", "id":id, "method":"turn/steer", "params":{
            "threadId":thread_id, "expectedTurnId":self.turn_id, "input":input,
        }});
        self.pending.insert(id, Pending::Steer(command));
        send_jsonrpc(stdin, &rpc).await
    }

    pub async fn response<W: AsyncWrite + Unpin>(
        &mut self,
        stdin: &mut W,
        message: &Value,
        thread_id: &str,
        mut on_accepted: impl FnMut(&str),
    ) -> Result<bool, String> {
        let Some(id) = message.get("id").and_then(Value::as_u64) else {
            return Ok(false);
        };
        let Some(pending) = self.pending.remove(&id) else {
            return Ok(false);
        };
        match pending {
            Pending::Skills(command) => {
                let selection = command.request.selected_skill.as_ref().unwrap();
                let skill = message
                    .get("result")
                    .and_then(|result| find_native_skill_input(result, selection));
                if let Some(skill) = skill {
                    self.send_input(stdin, command, thread_id, Some(&skill))
                        .await?;
                } else {
                    let error = message
                        .get("error")
                        .map(jsonrpc_error_message)
                        .unwrap_or_else(|| format!("未找到 Skill：{}", selection.title));
                    let _ = command.reply.send(Err(error));
                }
            }
            Pending::Steer(command) => {
                let result = if let Some(error) = message.get("error") {
                    // A rejected steer must not terminate the original turn.
                    let message = jsonrpc_error_message(error);
                    if message.to_lowercase().contains("no active turn") {
                        Ok(SteerResult { accepted: false })
                    } else {
                        Err(message)
                    }
                } else if message.pointer("/result/turnId").and_then(Value::as_str)
                    == self.turn_id.as_deref()
                {
                    on_accepted(&command.request.message_id);
                    Ok(SteerResult { accepted: true })
                } else {
                    Err("引导响应缺少匹配的 turnId，无法确认消息是否送达。".to_string())
                };
                let _ = command.reply.send(result);
            }
        }
        Ok(true)
    }

    pub fn close(&mut self) {
        self.receiver.close();
        while let Ok(command) = self.receiver.try_recv() {
            let _ = command.reply.send(Ok(SteerResult { accepted: false }));
        }
        for (_, pending) in self.pending.drain() {
            let (command, result) = match pending {
                Pending::Skills(command) => (command, Ok(SteerResult { accepted: false })),
                Pending::Steer(command) => (
                    command,
                    Err("对话已结束，未能确认引导消息是否送达，请检查后重试。".to_string()),
                ),
            };
            let _ = command.reply.send(result);
        }
    }
}

impl Drop for Steering {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command() -> (SteerCommand, oneshot::Receiver<Result<SteerResult, String>>) {
        let (reply, response) = oneshot::channel();
        (
            SteerCommand {
                request: SteerRequest {
                    run_id: "run-1".into(),
                    conversation_id: "conv-1".into(),
                    message_id: "queue-1".into(),
                    prompt: "先处理测试".into(),
                    selected_skill: None,
                    attachments: None,
                },
                reply,
            },
            response,
        )
    }

    fn active() -> Steering {
        let (_, receiver) = mpsc::channel(16);
        let mut steering = Steering::new(receiver);
        steering.turn_id = Some("turn-1".into());
        steering
    }

    #[tokio::test]
    async fn sends_to_active_turn_and_acknowledges_before_following_notifications() {
        let mut steering = active();
        let (mut command, mut response) = command();
        command.request.attachments = Some(vec![CodexChatAttachment {
            name: "chart.png".into(),
            kind: "image".into(),
            path: Some("/tmp/chart.png".into()),
        }]);
        let mut wire = Vec::new();
        steering
            .submit(&mut wire, command, "thread-1", "/repo")
            .await
            .unwrap();
        let rpc: Value = serde_json::from_slice(&wire).unwrap();
        assert_eq!(rpc["method"], "turn/steer");
        assert_eq!(rpc["params"]["expectedTurnId"], "turn-1");
        assert_eq!(rpc["params"]["threadId"], "thread-1");
        assert_eq!(
            rpc["params"]["input"][1],
            json!({"type":"localImage", "path":"/tmp/chart.png"})
        );
        assert!(response.try_recv().is_err());
        assert!(!steering
            .response(
                &mut wire,
                &json!({"method":"item/agentMessage/delta", "params":{"delta":"working"}}),
                "thread-1",
                |_| panic!("not an ack")
            )
            .await
            .unwrap());
        let mut accepted = Vec::new();
        assert!(steering
            .response(
                &mut wire,
                &json!({"id":100, "result":{"turnId":"turn-1"}}),
                "thread-1",
                |id| accepted.push(id.to_string())
            )
            .await
            .unwrap());
        assert_eq!(accepted, vec!["queue-1"]);
        assert_eq!(
            response.await.unwrap().unwrap(),
            SteerResult { accepted: true }
        );
    }

    #[tokio::test]
    async fn a_rejected_steer_does_not_fail_the_active_stream() {
        let mut steering = active();
        let (command, response) = command();
        let mut wire = Vec::new();
        steering
            .submit(&mut wire, command, "thread-1", "/repo")
            .await
            .unwrap();
        assert!(steering
            .response(
                &mut wire,
                &json!({"id":100, "error":{"code":-32600, "message":"turn mismatch"}}),
                "thread-1",
                |_| panic!("rejected")
            )
            .await
            .unwrap());
        assert_eq!(response.await.unwrap().unwrap_err(), "turn mismatch");
        assert_eq!(steering.turn_id.as_deref(), Some("turn-1"));
    }

    #[tokio::test]
    async fn reports_no_active_turn_as_not_sent() {
        let mut steering = active();
        let (command, response) = command();
        let mut wire = Vec::new();
        steering
            .submit(&mut wire, command, "thread-1", "/repo")
            .await
            .unwrap();
        steering
            .response(
                &mut wire,
                &json!({"id":100, "error":{"message":"no active turn to steer"}}),
                "thread-1",
                |_| panic!("not sent"),
            )
            .await
            .unwrap();
        assert_eq!(
            response.await.unwrap().unwrap(),
            SteerResult { accepted: false }
        );
    }

    #[tokio::test]
    async fn resolves_native_skill_without_consuming_unrelated_stream_events() {
        let mut steering = active();
        let (mut command, response) = command();
        command.request.selected_skill = Some(CodexSelectedSkill {
            id: "chrome".into(),
            title: "Chrome".into(),
            _description: None,
        });
        let mut wire = Vec::new();
        steering
            .submit(&mut wire, command, "thread-1", "/repo")
            .await
            .unwrap();
        let rpc: Value = serde_json::from_slice(&wire).unwrap();
        assert_eq!(rpc["method"], "skills/list");
        wire.clear();
        steering.response(&mut wire, &json!({"id":100, "result":{"data":[{"cwd":"/repo", "skills":[{"name":"chrome", "path":"/skills/chrome/SKILL.md"}]}]}}), "thread-1", |_| panic!("not yet sent")).await.unwrap();
        let rpc: Value = serde_json::from_slice(&wire).unwrap();
        assert_eq!(rpc["method"], "turn/steer");
        assert_eq!(
            rpc["params"]["input"][0],
            json!({"type":"skill", "name":"chrome", "path":"/skills/chrome/SKILL.md"})
        );
        steering
            .response(
                &mut wire,
                &json!({"id":101, "result":{"turnId":"turn-1"}}),
                "thread-1",
                |_| {},
            )
            .await
            .unwrap();
        assert!(response.await.unwrap().unwrap().accepted);
    }

    #[tokio::test]
    async fn closing_distinguishes_unsent_input_from_unacknowledged_input() {
        let (sender, receiver) = mpsc::channel(16);
        let mut steering = Steering::new(receiver);
        steering.turn_id = Some("turn-1".into());
        let (sent, sent_response) = command();
        steering
            .submit(&mut Vec::new(), sent, "thread-1", "/repo")
            .await
            .unwrap();
        let (unsent, unsent_response) = command();
        sender.send(unsent).await.unwrap();
        steering.close();
        assert!(sent_response.await.unwrap().is_err());
        assert_eq!(
            unsent_response.await.unwrap().unwrap(),
            SteerResult { accepted: false }
        );
    }
}
