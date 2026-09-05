//! Decode selected JSON string values while the document is still arriving.
//! Keeps only lexer state, never a complete tool argument document.
#[derive(Clone, Debug, Default)]
pub struct JsonStringField {
    in_string: bool,
    escaped: bool,
    unicode: Option<String>,
    high_surrogate: Option<u16>,
    candidate: String,
    selected: bool,
    capture: bool,
}

impl JsonStringField {
    pub fn push(&mut self, delta: &str, fields: &[&str]) -> String {
        let mut output = String::new();
        for ch in delta.chars() {
            if !self.in_string {
                match ch {
                    '"' => {
                        self.in_string = true;
                        self.capture = self.selected;
                        self.selected = false;
                        self.candidate.clear();
                    }
                    ':' => self.selected = fields.contains(&self.candidate.as_str()),
                    ch if ch.is_whitespace() => {}
                    _ => self.selected = false,
                }
                continue;
            }
            if let Some(hex) = &mut self.unicode {
                hex.push(ch);
                if hex.len() == 4 {
                    let code = u16::from_str_radix(hex, 16).ok();
                    self.unicode = None;
                    if let Some(code) = code {
                        if (0xd800..=0xdbff).contains(&code) {
                            self.high_surrogate = Some(code);
                        } else {
                            let code = match self.high_surrogate.take() {
                                Some(high) if (0xdc00..=0xdfff).contains(&code) => {
                                    0x10000 + ((u32::from(high) - 0xd800) << 10) + u32::from(code)
                                        - 0xdc00
                                }
                                _ => u32::from(code),
                            };
                            if let Some(ch) = char::from_u32(code) {
                                self.emit(ch, &mut output);
                            }
                        }
                    }
                }
                continue;
            }
            if self.escaped {
                self.escaped = false;
                let decoded = match ch {
                    'u' => {
                        self.unicode = Some(String::new());
                        continue;
                    }
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    'b' => '\u{8}',
                    'f' => '\u{c}',
                    _ => ch,
                };
                self.emit(decoded, &mut output);
            } else {
                match ch {
                    '\\' => self.escaped = true,
                    '"' => {
                        self.in_string = false;
                        self.capture = false;
                    }
                    _ => self.emit(ch, &mut output),
                }
            }
        }
        output
    }

    fn emit(&mut self, ch: char, output: &mut String) {
        if self.capture {
            output.push(ch);
        }
        // Only short keys can be selected. Long values must not become keys.
        if self.candidate.len() < 64 {
            self.candidate.push(ch);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_fragments_without_waiting_for_json_completion() {
        let mut decoder = JsonStringField::default();
        assert_eq!(
            decoder.push(r#"{"input":"first\n\u4e"#, &["input"]),
            "first\n"
        );
        assert_eq!(decoder.push(r#"2d\ud83d\u"#, &["input"]), "中");
        assert_eq!(
            decoder.push(r#"de80last","token":"hidden"}"#, &["input"]),
            "🚀last"
        );
    }
}
