import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const AUDIO_FILES = {
  start: "/audio/start.mp3",
  change: "/audio/change.mp3",
  lastOneMinute: "/audio/last-1min.mp3",
  finish: "/audio/finish.mp3",
};

const DEFAULT_MEMBERS = ["くまちゃん", "あっきー", "ざきさん", "うっち～", "エド"];

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createAudioMap() {
  const map = {};
  for (const [key, src] of Object.entries(AUDIO_FILES)) {
    const audio = new Audio(src);
    audio.preload = "auto";
    map[key] = audio;
  }
  return map;
}

function App() {
  const [matchMinutes, setMatchMinutes] = useState("7");
  const [matchSeconds, setMatchSeconds] = useState("0");
  const [changeMinutes, setChangeMinutes] = useState("1");
  const [changeSeconds, setChangeSeconds] = useState("30");

  const [membersText, setMembersText] = useState(DEFAULT_MEMBERS.join("\n"));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [goalieIndex, setGoalieIndex] = useState(0);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | running | paused | finished
  const [audioStatus, setAudioStatus] = useState("音声未確認");
  const [wakeLockStatus, setWakeLockStatus] = useState("画面スリープ対策: 未使用");

  const startedAtRef = useRef(null);
  const baseElapsedRef = useRef(0);
  const timerIdRef = useRef(null);
  const nextChangeAtRef = useRef(null);
  const lastOneMinutePlayedRef = useRef(false);
  const finishPlayedRef = useRef(false);
  const audioMapRef = useRef(null);
  const wakeLockRef = useRef(null);

  const members = useMemo(() => {
    const values = membersText
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);
    return values.length > 0 ? values : DEFAULT_MEMBERS;
  }, [membersText]);

  const matchDurationSeconds = useMemo(() => {
    const minutes = Math.max(0, toNumber(matchMinutes, 0));
    const seconds = Math.max(0, toNumber(matchSeconds, 0));
    return Math.max(10, Math.floor(minutes * 60 + seconds));
  }, [matchMinutes, matchSeconds]);

  const changeIntervalSeconds = useMemo(() => {
    const minutes = Math.max(0, toNumber(changeMinutes, 0));
    const seconds = Math.max(0, toNumber(changeSeconds, 0));
    return Math.max(10, Math.floor(minutes * 60 + seconds));
  }, [changeMinutes, changeSeconds]);

  const remainingSeconds = Math.max(0, matchDurationSeconds - elapsedSeconds);
  const nextChangeRemainingSeconds =
    status === "running" || status === "paused"
      ? Math.max(0, (nextChangeAtRef.current ?? changeIntervalSeconds) - elapsedSeconds)
      : changeIntervalSeconds;

  const currentGoalie = members[goalieIndex % members.length];
  const nextGoalie = members[(goalieIndex + 1) % members.length];

  useEffect(() => {
    audioMapRef.current = createAudioMap();

    return () => {
      if (timerIdRef.current) {
        clearInterval(timerIdRef.current);
      }
      releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    const onVisibilityChange = async () => {
      if (document.visibilityState === "visible" && status === "running") {
        await requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [status]);


  function speakMemberName(memberName, onEnd) {
    if (!memberName || !memberName.trim()) {
      onEnd?.();
      return;
    }

    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      onEnd?.();
      return;
    }

    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(`次は、${memberName}`);
      utterance.lang = "ja-JP";
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      let completed = false;
      const finish = () => {
        if (completed) {
          return;
        }
        completed = true;
        onEnd?.();
      };

      utterance.onend = finish;
      utterance.onerror = finish;

      // 一部ブラウザで onend が返らない場合の保険
      window.setTimeout(finish, 1800);

      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn("読み上げに失敗しました:", error);
      onEnd?.();
    }
  }

  function playChangeAnnouncement(memberName) {
    speakMemberName(memberName, () => {
      playAudio("change");
    });
  }

  function playAudio(key) {
    const audio = audioMapRef.current?.[key];
    if (!audio) {
      return;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.play().catch((error) => {
        console.warn("音声再生に失敗しました:", error);
        setAudioStatus("音声再生失敗: 端末の音量・マナーモード・ブラウザ制限を確認");
      });
    } catch (error) {
      console.warn("音声再生に失敗しました:", error);
      setAudioStatus("音声再生失敗");
    }
  }

  async function unlockAudio() {
    if (!audioMapRef.current) {
      audioMapRef.current = createAudioMap();
    }

    try {
      const audio = audioMapRef.current.start;
      audio.muted = true;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      setAudioStatus("音声準備OK");
    } catch (error) {
      console.warn("音声の事前許可に失敗しました:", error);
      setAudioStatus("音声準備未完了: テスト再生してください");
    }
  }

  async function testAudio() {
    await unlockAudio();
    playChangeAnnouncement(members[(goalieIndex + 1) % members.length]);
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      setWakeLockStatus("画面スリープ対策: このブラウザはWake Lock非対応");
      return;
    }

    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setWakeLockStatus("画面スリープ対策: 有効");
      wakeLockRef.current.addEventListener("release", () => {
        setWakeLockStatus("画面スリープ対策: 解除済み");
      });
    } catch (error) {
      console.warn("Wake Lockの取得に失敗しました:", error);
      setWakeLockStatus("画面スリープ対策: 取得失敗");
    }
  }

  async function releaseWakeLock() {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch (error) {
      console.warn("Wake Lockの解除に失敗しました:", error);
    }
  }

  function addLog(message, timeSeconds = elapsedSeconds) {
    setLogs((currentLogs) => [
      {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        time: formatTime(timeSeconds),
        message,
      },
      ...currentLogs,
    ]);
  }

  function tick() {
    const startedAt = startedAtRef.current;
    if (!startedAt) {
      return;
    }

    const now = Date.now();
    const nextElapsed = Math.min(
      matchDurationSeconds,
      Math.floor(baseElapsedRef.current + (now - startedAt) / 1000)
    );

    setElapsedSeconds(nextElapsed);

    if (
      matchDurationSeconds > 60 &&
      !lastOneMinutePlayedRef.current &&
      matchDurationSeconds - nextElapsed <= 60
    ) {
      lastOneMinutePlayedRef.current = true;
      playAudio("lastOneMinute");
      addLog("残り1分", nextElapsed);
    }

    while (
      nextChangeAtRef.current !== null &&
      nextChangeAtRef.current <= matchDurationSeconds &&
      nextElapsed >= nextChangeAtRef.current
    ) {
      const from = members[goalieIndexRef.current % members.length];
      const to = members[(goalieIndexRef.current + 1) % members.length];

      playChangeAnnouncement(to);
      setGoalieIndex((current) => {
        const nextIndex = (current + 1) % members.length;
        goalieIndexRef.current = nextIndex;
        return nextIndex;
      });
      addLog(`交代タイミング: ${from} → ${to}`, nextChangeAtRef.current);

      nextChangeAtRef.current += changeIntervalSeconds;
    }

    if (nextElapsed >= matchDurationSeconds && !finishPlayedRef.current) {
      finishPlayedRef.current = true;
      playAudio("finish");
      setStatus("finished");
      addLog("試合終了", matchDurationSeconds);

      if (timerIdRef.current) {
        clearInterval(timerIdRef.current);
        timerIdRef.current = null;
      }
      releaseWakeLock();
    }
  }

  const goalieIndexRef = useRef(goalieIndex);
  useEffect(() => {
    goalieIndexRef.current = goalieIndex;
  }, [goalieIndex]);

  async function startTimer() {
    await unlockAudio();
    await requestWakeLock();

    if (status === "finished") {
      resetTimer();
    }

    if (status === "idle") {
      setElapsedSeconds(0);
      setGoalieIndex(0);
      goalieIndexRef.current = 0;
      setLogs([]);
      nextChangeAtRef.current = changeIntervalSeconds;
      lastOneMinutePlayedRef.current = false;
      finishPlayedRef.current = false;
      baseElapsedRef.current = 0;
      addLog("試合開始", 0);
      playAudio("start");
    }

    if (status === "paused") {
      baseElapsedRef.current = elapsedSeconds;
      addLog("再開", elapsedSeconds);
    }

    startedAtRef.current = Date.now();
    setStatus("running");

    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
    }
    timerIdRef.current = setInterval(tick, 250);
  }

  function pauseTimer() {
    if (status !== "running") {
      return;
    }

    baseElapsedRef.current = elapsedSeconds;
    startedAtRef.current = null;
    setStatus("paused");
    addLog("一時停止", elapsedSeconds);

    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }

    releaseWakeLock();
  }

  function resetTimer() {
    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }

    setStatus("idle");
    setElapsedSeconds(0);
    setGoalieIndex(0);
    goalieIndexRef.current = 0;
    setLogs([]);
    startedAtRef.current = null;
    baseElapsedRef.current = 0;
    nextChangeAtRef.current = changeIntervalSeconds;
    lastOneMinutePlayedRef.current = false;
    finishPlayedRef.current = false;
    releaseWakeLock();
  }

  function manualChange() {
    const from = members[goalieIndex % members.length];
    const to = members[(goalieIndex + 1) % members.length];

    setGoalieIndex((current) => {
      const nextIndex = (current + 1) % members.length;
      goalieIndexRef.current = nextIndex;
      return nextIndex;
    });
    playChangeAnnouncement(to);
    addLog(`手動交代: ${from} → ${to}`, elapsedSeconds);

    if (status === "running" || status === "paused") {
      const next = elapsedSeconds + changeIntervalSeconds;
      nextChangeAtRef.current = next;
    }
  }

  const statusLabel = {
    idle: "開始前",
    running: "試合中",
    paused: "一時停止中",
    finished: "終了",
  }[status];

  return (
    <main className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">しゃべる交代タイマー</p>
          <h1>はぜくん2号</h1>
          <p className="lead">ゴレイロ交代のタイミングを、音声と大きな画面表示でサポートします。</p>
        </div>
        <div className={`status status-${status}`}>{statusLabel}</div>
      </header>

      <section className="timer-card">
        <div className="timer-label">残り時間</div>
        <div className="timer-display">{formatTime(remainingSeconds)}</div>
        <div className="timer-sub">
          経過 {formatTime(elapsedSeconds)} / 試合時間 {formatTime(matchDurationSeconds)}
        </div>

        <div className="goalie-panel">
          <div>
            <span className="small-label">現在のゴレイロ</span>
            <strong>{currentGoalie}</strong>
          </div>
          <div>
            <span className="small-label">次のゴレイロ</span>
            <strong>{nextGoalie}</strong>
          </div>
          <div>
            <span className="small-label">次の交代まで</span>
            <strong>{formatTime(nextChangeRemainingSeconds)}</strong>
          </div>
        </div>

        <div className="action-grid">
          {status !== "running" ? (
            <button className="primary" onClick={startTimer}>
              {status === "paused" ? "再開" : "試合開始"}
            </button>
          ) : (
            <button className="warning" onClick={pauseTimer}>一時停止</button>
          )}
          <button onClick={manualChange} disabled={status === "idle" || status === "finished"}>
            手動交代
          </button>
          <button onClick={resetTimer}>リセット</button>
          <button onClick={testAudio}>音声テスト</button>
        </div>

        <div className="notice">
          <div>{audioStatus}</div>
          <div>{wakeLockStatus}</div>
          <div>スマホの音量、マナーモード、Bluetoothスピーカー接続を試合前に確認してください。</div>
        </div>
      </section>

      <section className="settings-grid">
        <section className="card">
          <h2>試合設定</h2>
          <div className="field-row">
            <label>
              試合時間 分
              <input
                type="number"
                min="0"
                value={matchMinutes}
                onChange={(event) => setMatchMinutes(event.target.value)}
                disabled={status === "running" || status === "paused"}
              />
            </label>
            <label>
              試合時間 秒
              <input
                type="number"
                min="0"
                max="59"
                value={matchSeconds}
                onChange={(event) => setMatchSeconds(event.target.value)}
                disabled={status === "running" || status === "paused"}
              />
            </label>
          </div>

          <div className="field-row">
            <label>
              交代間隔 分
              <input
                type="number"
                min="0"
                value={changeMinutes}
                onChange={(event) => setChangeMinutes(event.target.value)}
                disabled={status === "running" || status === "paused"}
              />
            </label>
            <label>
              交代間隔 秒
              <input
                type="number"
                min="0"
                max="59"
                value={changeSeconds}
                onChange={(event) => setChangeSeconds(event.target.value)}
                disabled={status === "running" || status === "paused"}
              />
            </label>
          </div>
        </section>

        <section className="card">
          <h2>メンバー・交代順</h2>
          <p className="helper">上から順にゴレイロを交代します。1行に1人ずつ入力してください。</p>
          <textarea
            value={membersText}
            onChange={(event) => setMembersText(event.target.value)}
            disabled={status === "running" || status === "paused"}
            rows={6}
          />
        </section>
      </section>

      <section className="card">
        <h2>試合中ログ</h2>
        {logs.length === 0 ? (
          <p className="helper">試合を開始すると、交代や一時停止の履歴がここに表示されます。</p>
        ) : (
          <ul className="log-list">
            {logs.map((log) => (
              <li key={log.id}>
                <span>{log.time}</span>
                <strong>{log.message}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
