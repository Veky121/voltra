// SPDX-License-Identifier: MIT
use ron::value::RawValue;
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;

struct Name(String);
impl<'de> Deserialize<'de> for Name {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Identifier;
        impl Visitor<'_> for Identifier {
            type Value = Name;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a settings field")
            }
            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Name, E> {
                Ok(Name(value.to_owned()))
            }
        }
        deserializer.deserialize_identifier(Identifier)
    }
}

struct Fields<'a>(Vec<(String, &'a RawValue)>);
impl<'de> Deserialize<'de> for Fields<'de> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Root;
        impl<'de> Visitor<'de> for Root {
            type Value = Fields<'de>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a RON settings struct")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut fields = Vec::new();
                let mut names = HashSet::new();
                while let Some(Name(name)) = map.next_key::<Name>()? {
                    if !names.insert(name.clone()) {
                        return Err(serde::de::Error::custom("duplicate settings field"));
                    }
                    let value = map.next_value::<&RawValue>()?;
                    fields.push((name, value));
                }
                Ok(Fields(fields))
            }
        }
        deserializer.deserialize_struct("Settings", &[], Root)
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
enum Change {
    String(String),
    Integer(u64),
    Boolean(bool),
    OptionString(Option<String>),
    Raw(String),
}
impl Change {
    fn literal(&self) -> Result<String, String> {
        let encoded = match self {
            Self::String(value) => ron::ser::to_string(value),
            Self::Integer(value) => ron::ser::to_string(value),
            Self::Boolean(value) => ron::ser::to_string(value),
            Self::OptionString(value) => ron::ser::to_string(value),
            Self::Raw(value) => {
                RawValue::from_ron(value).map_err(|_| "Invalid managed RON literal")?;
                return Ok(value.clone());
            }
        };
        encoded.map_err(|_| "Cannot serialize managed RON value".to_owned())
    }
}

fn parse(source: &str) -> Result<(Fields<'_>, usize), String> {
    let mut deserializer =
        ron::Deserializer::from_str(source).map_err(|_| "Invalid RON settings")?;
    let fields = Fields::deserialize(&mut deserializer)
        .map_err(|_| "Invalid or duplicate RON settings fields")?;
    let end = source.len() - deserializer.remainder().len();
    deserializer
        .end()
        .map_err(|_| "Unexpected content after RON settings")?;
    if end == 0 || source.as_bytes()[end - 1] != b')' {
        return Err("Unsupported RON root settings layout".to_owned());
    }
    Ok((fields, end - 1))
}

fn render(source: &str, changes: &BTreeMap<String, Change>) -> Result<String, String> {
    let (fields, closing) = parse(source)?;
    let mut edits = Vec::new();
    let mut found = HashSet::new();
    let mut last_end = None;
    for (name, raw) in fields.0 {
        let literal = raw.trim().get_ron();
        let start = (literal.as_ptr() as usize)
            .checked_sub(source.as_ptr() as usize)
            .ok_or("RON field is not borrowed from its source")?;
        let end = start.checked_add(literal.len()).ok_or("Invalid RON span")?;
        if end > source.len() || !source.is_char_boundary(start) || !source.is_char_boundary(end) {
            return Err("Invalid RON field span".to_owned());
        }
        last_end = Some(end);
        if let Some(value) = changes.get(&name) {
            found.insert(name);
            let replacement = value.literal()?;
            if literal != replacement {
                edits.push((start, end, replacement));
            }
        }
    }
    let mut additions = Vec::new();
    for (name, value) in changes {
        if !name
            .chars()
            .enumerate()
            .all(|(i, c)| c == '_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit()))
            || name.is_empty()
        {
            return Err("Invalid managed field name".to_owned());
        }
        if !found.contains(name) {
            additions.push(format!("    {}: {}", name, value.literal()?));
        }
    }
    if !additions.is_empty() {
        let at = last_end.unwrap_or(closing);
        let prefix = if last_end.is_some() { ",\n" } else { "\n" };
        edits.push((at, at, format!("{}{}\n", prefix, additions.join(",\n"))));
    }
    edits.sort_by_key(|edit| std::cmp::Reverse(edit.0));
    let mut result = source.to_owned();
    for (start, end, replacement) in edits {
        result.replace_range(start..end, &replacement);
    }
    parse(&result)?;
    Ok(result)
}

fn update(path: &Path, changes: &BTreeMap<String, Change>) -> Result<bool, String> {
    let existed = path.exists();
    let source = if existed {
        fs::read_to_string(path).map_err(|_| "Cannot read existing RON settings")?
    } else {
        "()\n".to_owned()
    };
    let result = render(&source, changes)?;
    if existed && result == source {
        return Ok(false);
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|_| "Cannot create settings directory")?;
    let temporary = parent.join(format!(".ron-update-{}.tmp", std::process::id()));
    let mut staged = false;
    let mut transaction = || -> Result<(), String> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Cannot stage RON settings")?;
        staged = true;
        file.write_all(result.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot write staged RON settings")?;
        drop(file);
        if existed {
            fs::copy(
                path,
                path.with_file_name(format!(
                    "{}.voltra-backup",
                    path.file_name()
                        .ok_or("Missing settings file name")?
                        .to_string_lossy()
                )),
            )
            .map_err(|_| "Cannot preserve settings backup")?;
        }
        fs::rename(&temporary, path).map_err(|_| "Cannot replace RON settings")?;
        Ok(())
    };
    let result = transaction();
    if result.is_err() && staged {
        let _ = fs::remove_file(&temporary);
    }
    result.map(|_| true)
}

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 1 {
        return Err(
            "Usage: voltra-ron-config FILE, with managed changes as JSON on stdin".to_owned(),
        );
    }
    let mut input = String::new();
    io::stdin()
        .take(4 * 1024 * 1024 + 1)
        .read_to_string(&mut input)
        .map_err(|_| "Cannot read managed settings")?;
    if input.len() > 4 * 1024 * 1024 {
        return Err("Managed settings request is too large".to_owned());
    }
    let changes = serde_json::from_str(&input).map_err(|_| "Invalid managed settings request")?;
    let changed = update(Path::new(&args[0]), &changes)?;
    println!("{{\"changed\":{changed}}}");
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("RON settings update failed: {error}. Existing settings were retained.");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn change(value: &str) -> Change {
        Change::String(value.to_owned())
    }
    #[test]
    fn preserves_enums_comments_and_nested_operator_fields() {
        let source = "// operator\n(\n gameserver_protocols: [Tcp(address: \"0.0.0.0:14004\")], // keep\n custom: (server_name: r#\"nested, :)\"#),\n server_name: \"old\", /* keep too */\n) // trailing ) comment\n";
        let result = render(
            source,
            &BTreeMap::from([(
                "server_name".to_owned(),
                change("New, $literal 世界 \"quoted\""),
            )]),
        )
        .unwrap();
        assert!(result.contains("custom: (server_name: r#\"nested, :)\"#)"));
        assert!(result.contains("// keep"));
        assert!(result.contains("/* keep too */"));
        assert!(result.ends_with("// trailing ) comment\n"));
        #[derive(Deserialize)]
        struct Native {
            server_name: String,
        }
        assert_eq!(
            ron::from_str::<Native>(&result).unwrap().server_name,
            "New, $literal 世界 \"quoted\""
        );
    }
    #[test]
    fn additions_work_with_or_without_a_trailing_comma() {
        for source in [
            "()",
            "(/* empty */)",
            "(existing: Some(7))",
            "(existing: Some(7), // last\n)",
        ] {
            let changes = BTreeMap::from([
                ("max_players".to_owned(), Change::Integer(30)),
                ("server_name".to_owned(), change("Name")),
            ]);
            let result = render(source, &changes).unwrap();
            #[derive(Deserialize)]
            struct Native {
                max_players: u16,
                server_name: String,
            }
            let native: Native = ron::from_str(&result).unwrap();
            assert_eq!(native.max_players, 30);
            assert_eq!(native.server_name, "Name");
            assert_eq!(render(&result, &changes).unwrap(), result);
        }
    }
    #[test]
    fn invalid_and_duplicate_input_is_rejected() {
        for source in [
            "(name: \"unterminated)",
            "(name: 1, name: 2)",
            "(name: 1) trailing",
            "(name: [Broken(])",
        ] {
            assert!(render(source, &BTreeMap::new()).is_err());
        }
        assert!(render(
            "()",
            &BTreeMap::from([("bad:field".to_owned(), change("x"))])
        )
        .is_err());
        assert!(render(
            "()",
            &BTreeMap::from([("value".to_owned(), Change::Raw("1, other: true".to_owned()))])
        )
        .is_err());
    }
    #[test]
    fn identical_config_bytes_remain_identical() {
        let source = "(server_name : /* note */ \"Same\" , custom: [One, Two(4)])\r\n";
        assert_eq!(
            render(
                source,
                &BTreeMap::from([("server_name".to_owned(), change("Same"))])
            )
            .unwrap(),
            source
        );
    }
    #[test]
    fn options_and_control_characters_use_native_serialization() {
        let text = "Quotes\" \\ newline\n tab\t null\0 世界";
        let changes = BTreeMap::from([
            ("name".to_owned(), change(text)),
            (
                "auth".to_owned(),
                Change::OptionString(Some("https://auth.veloren.net".to_owned())),
            ),
        ]);
        let result = render("()", &changes).unwrap();
        #[derive(Deserialize)]
        struct Native {
            name: String,
            auth: Option<String>,
        }
        let native: Native = ron::from_str(&result).unwrap();
        assert_eq!(native.name, text);
        assert_eq!(native.auth.as_deref(), Some("https://auth.veloren.net"));
    }

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let directory = std::env::temp_dir().join(format!(
                "voltra-ron-tests-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&directory).unwrap();
            Self(directory)
        }
        fn path(&self) -> std::path::PathBuf {
            self.0.join("settings.ron")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            for name in [
                "settings.ron".to_owned(),
                "settings.ron.voltra-backup".to_owned(),
                format!(".ron-update-{}.tmp", std::process::id()),
            ] {
                let _ = fs::remove_file(self.0.join(name));
            }
            let _ = fs::remove_dir(&self.0);
        }
    }
    #[test]
    fn update_preserves_backup_and_unchanged_files() {
        let fixture = Fixture::new();
        let original = "// own settings\r\n(server_name: \"Old\", custom: Enum(1))\r\n";
        fs::write(fixture.path(), original).unwrap();
        assert!(!update(
            &fixture.path(),
            &BTreeMap::from([("server_name".to_owned(), change("Old"))])
        )
        .unwrap());
        assert!(!fixture.0.join("settings.ron.voltra-backup").exists());
        assert!(update(
            &fixture.path(),
            &BTreeMap::from([("server_name".to_owned(), change("New"))])
        )
        .unwrap());
        assert_eq!(
            fs::read_to_string(fixture.0.join("settings.ron.voltra-backup")).unwrap(),
            original
        );
        assert!(fs::read_to_string(fixture.path())
            .unwrap()
            .contains("custom: Enum(1)"));
    }
    #[test]
    fn invalid_existing_file_is_not_modified_or_backed_up() {
        let fixture = Fixture::new();
        let original = "(name: \"private value\", broken: [)";
        fs::write(fixture.path(), original).unwrap();
        let error = update(&fixture.path(), &BTreeMap::new()).unwrap_err();
        assert!(!error.contains("private value"));
        assert_eq!(fs::read_to_string(fixture.path()).unwrap(), original);
        assert!(!fixture.0.join("settings.ron.voltra-backup").exists());
    }
    #[test]
    fn temporary_file_collision_keeps_both_existing_files() {
        let fixture = Fixture::new();
        fs::write(fixture.path(), "()").unwrap();
        let collision = fixture
            .0
            .join(format!(".ron-update-{}.tmp", std::process::id()));
        fs::write(&collision, "other operation").unwrap();
        assert!(update(
            &fixture.path(),
            &BTreeMap::from([("name".to_owned(), change("New"))])
        )
        .is_err());
        assert_eq!(fs::read_to_string(fixture.path()).unwrap(), "()");
        assert_eq!(fs::read_to_string(collision).unwrap(), "other operation");
    }
}
