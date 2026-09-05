//! Track each native message independently. A completed item is authoritative,
//! including when its last delta was missing or a plan was revised.
use std::collections::HashMap;

#[derive(Default)]
pub struct TextStreams {
    text: HashMap<(String, String), String>,
    last: HashMap<String, String>,
}

impl TextStreams {
    pub fn delta(&mut self, channel: &str, id: Option<&str>, delta: &str) {
        let key = id.unwrap_or("").to_string();
        self.text
            .entry((channel.into(), key.clone()))
            .or_default()
            .push_str(delta);
        self.last.insert(channel.into(), key);
    }

    // Return None only for an exact duplicate, never because an unrelated
    // message in this turn happened to stream before this item.
    pub fn complete(
        &mut self,
        channel: &str,
        id: Option<&str>,
        text: &str,
    ) -> Option<Option<String>> {
        let matched = id.map(str::to_owned).or_else(|| {
            let last = self.last.get(channel)?;
            let previous = self.text.get(&(channel.into(), last.clone()))?;
            (!previous.is_empty() && text.starts_with(previous)).then(|| last.clone())
        });
        let key = (channel.to_string(), matched.clone().unwrap_or_default());
        if self.text.get(&key).is_some_and(|previous| previous == text) {
            return None;
        }
        self.text.insert(key, text.to_string());
        if let Some(id) = &matched {
            self.last.insert(channel.into(), id.clone());
        }
        Some(matched.filter(|id| !id.is_empty()))
    }
}
