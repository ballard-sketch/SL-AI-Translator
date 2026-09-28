use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use crate::constants::EVENT_LOG_UPDATE;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static IS_WATCHING: AtomicBool = AtomicBool::new(false);

/// 最后一条消息在这段时间内没有续行写入，才认为它已经完整
const PENDING_FLUSH_AFTER: Duration = Duration::from_millis(400);

#[derive(Serialize, Clone)]
struct LogMessage {
    source: String,
    msg: String,
}

/// 单个日志文件的读取状态
#[derive(Default)]
struct FileState {
    /// 已处理到的字节偏移（总是停在某个换行之后）
    offset: u64,
    /// 正在拼接的多行消息
    assembler: MessageAssembler,
    /// assembler 里最后一次追加内容的时间
    last_append: Option<Instant>,
}

pub struct LogWatcherService;

impl LogWatcherService {
    /// 启动监听：对 target_dir 下的所有 .log / .txt 文件进行增量读取
    pub fn start_watching(app_handle: AppHandle, target_dir: PathBuf) -> Result<(), String> {
        if !target_dir.is_dir() {
            return Err(format!("聊天记录日志目录不存在: {}", target_dir.display()));
        }

        // 防多指/重复点击产生无限线程
        if IS_WATCHING.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        // 启动前先把所有现存文件的 offset 设到末尾，避免重复读历史消息
        let mut states = Self::init_states(&target_dir);

        thread::spawn(move || {
            use notify::{RecursiveMode, Watcher};
            use std::sync::mpsc::channel;

            let (tx, rx) = channel();

            // 使用跨平台的系统原生文件通知监听器
            let mut watcher = match notify::recommended_watcher(tx) {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("初始化 watcher 失败: {}", e);
                    IS_WATCHING.store(false, Ordering::SeqCst);
                    return;
                }
            };

            if let Err(e) = watcher.watch(&target_dir, RecursiveMode::NonRecursive) {
                eprintln!("监听目录失败: {}", e);
                IS_WATCHING.store(false, Ordering::SeqCst);
                return;
            }

            loop {
                if !IS_WATCHING.load(Ordering::SeqCst) {
                    break;
                }

                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(Ok(event)) => {
                        for path in event.paths {
                            if Self::is_log_file(&path) {
                                let state = states.entry(path.clone()).or_default();
                                Self::read_new_content(&path, state, &app_handle);
                            }
                        }
                    }
                    Ok(Err(_)) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => break, // 通道断开则退出线程
                }

                Self::flush_idle(&mut states, &app_handle);
            }
        });

        Ok(())
    }

    /// 停止监听
    pub fn stop_watching() {
        IS_WATCHING.store(false, Ordering::SeqCst);
    }

    /// 初始化：把目录下所有日志文件的 offset 设置到当前末尾
    fn init_states(dir: &Path) -> HashMap<PathBuf, FileState> {
        let mut map = HashMap::new();
        let Ok(entries) = std::fs::read_dir(dir) else {
            return map;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if Self::is_log_file(&path) {
                if let Ok(meta) = std::fs::metadata(&path) {
                    map.insert(
                        path,
                        FileState {
                            offset: meta.len(),
                            ..Default::default()
                        },
                    );
                }
            }
        }
        map
    }

    /// 读取文件新增内容，只处理到最后一个完整换行为止；
    /// 写到一半的行留在文件里，下次事件再读
    fn read_new_content(path: &Path, state: &mut FileState, app: &AppHandle) {
        let Ok(mut file) = File::open(path) else {
            return;
        };
        let Ok(meta) = file.metadata() else { return };
        let file_len = meta.len();

        // 文件被截断或重建：从头开始读
        if file_len < state.offset {
            state.offset = 0;
            state.assembler = MessageAssembler::default();
        }
        if file_len == state.offset {
            return;
        }

        if file.seek(SeekFrom::Start(state.offset)).is_err() {
            return;
        }
        let mut buf = Vec::with_capacity((file_len - state.offset) as usize);
        if file.read_to_end(&mut buf).is_err() {
            return;
        }

        let Some(last_nl) = buf.iter().rposition(|&b| b == b'\n') else {
            return; // 还没有一整行
        };
        let complete = &buf[..=last_nl];
        state.offset += complete.len() as u64;

        // 单个非法字节不应该让整段内容丢失
        let text = String::from_utf8_lossy(complete);
        let source = Self::source_name(path);
        for line in text.lines() {
            if let Some(done) = state.assembler.push_line(line) {
                Self::emit(app, &source, done);
            }
        }
        if state.assembler.has_pending() {
            state.last_append = Some(Instant::now());
        }
    }

    /// 把一段时间没有新续行的消息发出去
    fn flush_idle(states: &mut HashMap<PathBuf, FileState>, app: &AppHandle) {
        for (path, state) in states.iter_mut() {
            let Some(t) = state.last_append else { continue };
            if t.elapsed() < PENDING_FLUSH_AFTER {
                continue;
            }
            state.last_append = None;
            if let Some(done) = state.assembler.finish() {
                Self::emit(app, &Self::source_name(path), done);
            }
        }
    }

    fn emit(app: &AppHandle, source: &str, msg: String) {
        let _ = app.emit(
            EVENT_LOG_UPDATE,
            LogMessage {
                source: source.to_string(),
                msg,
            },
        );
    }

    fn source_name(path: &Path) -> String {
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("chat.txt")
            .to_string()
    }

    /// 判断是否为 Firestorm 日志文件（.log 或 .txt）
    fn is_log_file(path: &Path) -> bool {
        matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("log") | Some("txt")
        )
    }
}

// ── 日志解析 ─────────────────────────────────────────────────────────
//
// Firestorm / 官方客户端的行格式：
//   [2026/04/11 07:08]  Sender Name: message
//   [2026/04/11 07:08]  [secondlife:///app/agent/<uuid>/about Name]: message
//   [2026/04/11 07:08]  [secondlife:///app/agent/<uuid>/about Name] waves   (/me 动作)
// 多行消息只有第一行带时间戳，后续行以一个空格开头：
//   [2026/04/11 03:51]  Rift - HUD:
//    Welcome, someone.
//    Systems ready.

/// 把逐行输入拼成完整消息，输出统一为 "Sender: text"
#[derive(Default)]
pub struct MessageAssembler {
    current: Option<String>,
}

impl MessageAssembler {
    /// 输入一行；如果这行开启了新消息，返回上一条已完整的消息
    pub fn push_line(&mut self, line: &str) -> Option<String> {
        if let Some(rest) = strip_timestamp(line) {
            let done = self.finish();
            // 解析不了的行（无发送者的物体消息等）置为 None，
            // 它后面的续行也随之丢弃，不会错接到上一条消息上
            self.current = parse_body(rest);
            return done;
        }
        if let Some(cur) = self.current.as_mut() {
            let cont = line.strip_prefix(' ').unwrap_or(line).trim_end();
            cur.push('\n');
            cur.push_str(cont);
        }
        None
    }

    pub fn has_pending(&self) -> bool {
        self.current.is_some()
    }

    /// 结束当前消息并返回；正文为空的消息丢弃
    pub fn finish(&mut self) -> Option<String> {
        let raw = self.current.take()?;
        let (sender, text) = raw.split_once(": ")?;
        let text = text.trim_matches(|c: char| c == '\n' || c == '\r' || c == ' ');
        if sender.is_empty() || text.is_empty() {
            return None;
        }
        Some(format!("{}: {}", sender, text))
    }
}

/// 行首是 [时间戳] 或 裸时间戳 时返回其后的内容
fn strip_timestamp(line: &str) -> Option<&str> {
    if let Some(inner_and_rest) = line.strip_prefix('[') {
        let close = inner_and_rest.find(']')?;
        let inner = &inner_and_rest[..close];
        if is_timestamp(inner) {
            return Some(&inner_and_rest[close + 1..]);
        }
        return None;
    }
    // 旧格式：2026/04/10 13:00  Sender: message
    let first = line.chars().next()?;
    if first.is_ascii_digit() {
        let head = line.get(..16)?;
        if is_timestamp(head) && head.contains('/') {
            return Some(&line[16..]);
        }
    }
    None
}

/// 时间戳只由数字、日期时间分隔符和 AM/PM 组成，且至少含一个 ':'
fn is_timestamp(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() || s.len() > 25 || !s.contains(':') {
        return false;
    }
    let body = s
        .trim_end_matches(|c: char| matches!(c, 'A' | 'P' | 'M' | 'a' | 'p' | 'm'))
        .trim_end();
    body.chars().next().is_some_and(|c| c.is_ascii_digit())
        && body
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '/' | ':' | '-' | '.' | ' '))
}

/// 解析时间戳后面的部分，返回 "Sender: text"（text 可能为空，由续行补齐）
fn parse_body(rest: &str) -> Option<String> {
    let rest = rest.trim_start();
    if rest.is_empty() {
        return None;
    }

    // 带头像链接的发送者：[secondlife:///app/agent/<uuid>/about Name]
    const AGENT_PREFIX: &str = "[secondlife:///app/agent/";
    if rest.starts_with(AGENT_PREFIX) {
        let close = rest.find(']')?;
        let link = &rest[1..close];
        let name = link.split_once("/about ").map(|(_, n)| n.trim())?;
        if name.is_empty() {
            return None;
        }
        let after = &rest[close + 1..];
        let text = match after.strip_prefix(':') {
            Some(t) => t.trim(),
            // 没有冒号 = /me 动作，动作内容本身就是正文
            None => after.trim(),
        };
        return Some(format!("{}: {}", name, text));
    }

    let lower = rest.to_lowercase();
    if lower.starts_with("secondlife:") {
        return None;
    }

    if let Some((sender, text)) = rest.split_once(": ") {
        return Some(format!("{}: {}", sender.trim_end(), text.trim_end()));
    }
    // "Rift - HUD:" 这种正文全在续行里的消息
    if let Some(sender) = rest.trim_end().strip_suffix(':') {
        if !sender.is_empty() {
            return Some(format!("{}: ", sender));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(lines: &[&str]) -> Vec<String> {
        let mut a = MessageAssembler::default();
        let mut out: Vec<String> = lines.iter().filter_map(|l| a.push_line(l)).collect();
        out.extend(a.finish());
        out
    }

    #[test]
    fn single_line() {
        assert_eq!(
            run(&["[2026/04/11 07:07]  Alice Smith: hello there"]),
            vec!["Alice Smith: hello there"]
        );
    }

    #[test]
    fn multi_line_is_merged() {
        assert_eq!(
            run(&[
                "[2026/04/11 07:07]  Bob: first line",
                " second line",
                " third line",
                "[2026/04/11 07:08]  Carol: next",
            ]),
            vec!["Bob: first line\nsecond line\nthird line", "Carol: next"]
        );
    }

    #[test]
    fn header_with_empty_first_line() {
        assert_eq!(
            run(&[
                "[2026/04/11 03:51]  Rift - HUD: ",
                " Welcome, someone.",
                " Systems ready.",
            ]),
            vec!["Rift - HUD: Welcome, someone.\nSystems ready."]
        );
    }

    #[test]
    fn agent_link_sender_and_emote() {
        assert_eq!(
            run(&[
                "[2026/04/11 07:08]  [secondlife:///app/agent/b6809d55-36bb-45dc-ac00-85a0e5a1d61f/about Bea Venom]:  hi all",
                "[2026/04/11 07:09]  [secondlife:///app/agent/b6809d55-36bb-45dc-ac00-85a0e5a1d61f/about Bea Venom] waves",
            ]),
            vec!["Bea Venom: hi all", "Bea Venom: waves"]
        );
    }

    #[test]
    fn unparseable_header_drops_its_continuations() {
        assert_eq!(
            run(&[
                "[2026/04/11 07:07]  Dan: ok",
                "[2026/04/13 20:23]  some object text without colon",
                " continuation of the object text",
            ]),
            vec!["Dan: ok"]
        );
    }

    #[test]
    fn noise_before_first_message_is_ignored() {
        assert_eq!(
            run(&[
                "ENC:abc:def",
                "<<<<<<< HEAD",
                "[2026/04/11 07:07]  Eve: hey",
            ]),
            vec!["Eve: hey"]
        );
    }

    #[test]
    fn bracket_text_in_continuation_is_not_a_new_message() {
        assert_eq!(
            run(&["[2026/04/11 07:07]  Finn: look", "[OOC] brb"]),
            vec!["Finn: look\n[OOC] brb"]
        );
    }

    #[test]
    fn timestamp_variants() {
        assert!(is_timestamp("2026/04/11 07:07"));
        assert!(is_timestamp("2026/04/11 07:07:33"));
        assert!(is_timestamp("07:07"));
        assert!(is_timestamp("7:07 PM"));
        assert!(!is_timestamp("OOC"));
        assert!(!is_timestamp("secondlife:///app/agent/x/about y"));
        assert_eq!(
            run(&["2026/04/10 13:00  Gus: legacy format"]),
            vec!["Gus: legacy format"]
        );
    }

    /// 用真实日志回放：SL_SAMPLE_LOG=<chat.txt> cargo test -- --ignored --nocapture
    #[test]
    #[ignore]
    fn replay_sample_log() {
        let path = std::env::var("SL_SAMPLE_LOG").expect("set SL_SAMPLE_LOG");
        let bytes = std::fs::read(path).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        let lines: Vec<&str> = text.lines().collect();
        let out = run(&lines);
        let multi = out.iter().filter(|m| m.contains('\n')).count();
        let continuation_lines = lines
            .windows(2)
            .filter(|w| strip_timestamp(w[1]).is_none() && strip_timestamp(w[0]).is_some())
            .count();
        println!(
            "lines={} messages={} multi_line_messages={} continuation_starts={}",
            lines.len(),
            out.len(),
            multi,
            continuation_lines
        );
        assert!(multi > 0);
        assert!(out.iter().all(|m| m.contains(": ")));
    }

    #[test]
    fn system_link_line_is_skipped() {
        assert_eq!(run(&["[2026/04/11 07:07]  secondlife:///app/foo: bar"]), Vec::<String>::new());
    }
}
