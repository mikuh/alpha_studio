use std::str::FromStr;

use rust_decimal::Decimal;
use serde::{de::Error as _, Deserialize, Deserializer, Serializer};
use serde_json::{Number, Value};

pub const YUAN_SCALE: u32 = 6;
pub const MICROS_PER_YUAN: i64 = 1_000_000;

pub fn deserialize_decimal<'de, D>(deserializer: D) -> Result<Decimal, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::Number(number) => Decimal::from_str(&number.to_string()).map_err(D::Error::custom),
        Value::String(text) => Decimal::from_str(text.trim()).map_err(D::Error::custom),
        _ => Err(D::Error::custom(
            "money must be a JSON number or decimal string",
        )),
    }
}

pub fn serialize_decimal_string<S>(value: &Decimal, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&value.normalize().to_string())
}

pub fn decimal_json(value: Decimal) -> Value {
    Number::from_str(&value.normalize().to_string())
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

pub fn has_supported_scale(value: Decimal) -> bool {
    value.scale() <= YUAN_SCALE
}

pub fn round_up_micro_yuan(value: Decimal) -> Decimal {
    if value <= Decimal::ZERO {
        return Decimal::ZERO;
    }
    let micros = Decimal::from(MICROS_PER_YUAN);
    (value * micros).ceil() / micros
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_positive_charges_up_to_one_micro_yuan() {
        assert_eq!(
            round_up_micro_yuan(Decimal::from_str("0.0000001").unwrap()),
            Decimal::from_str("0.000001").unwrap()
        );
        assert_eq!(
            round_up_micro_yuan(Decimal::from_str("1.230000").unwrap()),
            Decimal::from_str("1.23").unwrap()
        );
    }

    #[test]
    fn emits_decimal_json_without_binary_float_conversion() {
        assert_eq!(
            decimal_json(Decimal::from_str("0.100001").unwrap()).to_string(),
            "0.100001"
        );
    }
}
