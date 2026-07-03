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
const DEFAULT_OPPONENTS = ["相手1", "相手2", "相手3", "相手4", "相手5"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createInitialOwnPlayers(memberNames) {
  const patterns = [
    { x: 12, y: 50 },
    { x: 28, y: 22 },
    { x: 34, y: 40 },
    { x: 34, y: 60 },
    { x: 28, y: 78 },
    { x: 46, y: 50 },
    { x: 20, y: 35 },
    { x: 20, y: 65 },
  ];

  return memberNames.map((name, index) => {
    const fallbackY = 18 + (index % 8) * 9;
    const point = patterns[index] ?? { x: 18, y: fallbackY };
    return { id: `own-${index}-${name}`, type: "own", name, ...point };
  });
}

function createInitialOpponents() {
  const patterns = [
    { x: 88, y: 50 },
    { x: 72, y: 22 },
    { x: 66, y: 40 },
    { x: 66, y: 60 },
    { x: 72, y: 78 },
  ];

  return DEFAULT_OPPONENTS.map((name, index) => ({
    id: `opponent-${index}`,
    type: "opponent",
    name,
    ...patterns[index],
  }));
}

function createInitialBoard(memberNames) {
  return {
    own: createInitialOwnPlayers(memberNames),
    opponents: createInitialOpponents(),
    ball: { id: "ball", type: "ball", name: "ボール", x: 50, y: 50 },
  };
}

function mergeOwnPlayersWithMembers(currentOwnPlayers, memberNames) {
  const currentByName = new Map(currentOwnPlayers.map((player) => [player.name, player]));
  const initial = createInitialOwnPlayers(memberNames);

  return memberNames.map((name, index) => {
    const existing = currentByName.get(name);
    if (existing) {
      return { ...existing, id: `own-${index}-${name}`, name };
    }
    return initial[index];
  });
}

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
  const [view, setView] = useState("timer");
  const [matchMinutes, setMatchMinutes] = useState("7");
  const [matchSeconds, setMatchSeconds] = useState("0");
  const [changeMinutes, setChangeMinutes] = useState("1");
  const [changeSeconds, setChangeSeconds] = useState("30");

  const [membersText, setMembersText] = useState(DEFAULT_MEMBERS.join("\n"));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [goalieIndex, setGoalieIndex] = useState(0);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | running | paused | finished
  const [audioStatus, setAudioStatus] = useState("音声未準備: 試合前に「音声準備」を押してください");
  const [audioReady, setAudioReady] = useState(false);
  const [wakeLockStatus, setWakeLockStatus] = useState("画面スリープ対策: 未使用");

  const startedAtRef = useRef(null);
  const baseElapsedRef = useRef(0);
  const timerIdRef = useRef(null);
  const nextChangeAtRef = useRef(null);
  const lastOneMinutePlayedRef = useRef(false);
  const finishPlayedRef = useRef(false);
  const audioMapRef = useRef(null);
  const sharedAudioRef = useRef(null);
  const wakeLockRef = useRef(null);

  const members = useMemo(() => {
    const values = membersText
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);
    return values.length > 0 ? values : DEFAULT_MEMBERS;
  }, [membersText]);

  const [boardState, setBoardState] = useState(() => createInitialBoard(DEFAULT_MEMBERS));

  useEffect(() => {
    setBoardState((current) => ({
      ...current,
      own: mergeOwnPlayersWithMembers(current.own, members),
    }));
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
    sharedAudioRef.current = new Audio();
    sharedAudioRef.current.preload = "auto";

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
    const src = AUDIO_FILES[key];
    if (!src) {
      return;
    }

    try {
      const audio = sharedAudioRef.current ?? new Audio();
      sharedAudioRef.current = audio;

      const absoluteSrc = new URL(src, window.location.href).href;
      if (audio.src !== absoluteSrc) {
        audio.src = src;
      }

      audio.preload = "auto";
      audio.muted = false;
      audio.volume = 1;
      audio.pause();
      audio.currentTime = 0;

      audio.play().catch((error) => {
        console.warn("音声再生に失敗しました:", error);
        setAudioStatus("音声再生失敗: Safariで開くか、手動交代を一度押してください");
      });
    } catch (error) {
      console.warn("音声再生に失敗しました:", error);
      setAudioStatus("音声再生失敗");
    }
  }

  function prepareAudioForIOS() {
    if (!audioMapRef.current) {
      audioMapRef.current = createAudioMap();
    }

    const sampleMember = members[(goalieIndex + 1) % members.length] ?? "メンバー";

    // iPhone/LINE内ブラウザでは play() の成否判定が不安定な場合があるため、
    // 「音声準備を試したら試合開始可能」にしてユーザーが詰まらないようにする。
    setAudioReady(true);
    setAudioStatus("音声準備中: 交代音声を再生します");

    try {
      const audio = sharedAudioRef.current ?? new Audio();
      sharedAudioRef.current = audio;
      audio.preload = "auto";
      audio.src = AUDIO_FILES.change;
      audio.muted = false;
      audio.volume = 1;
      audio.pause();
      audio.currentTime = 0;

      const playPromise = audio.play();

      if (playPromise && typeof playPromise.then === "function") {
        playPromise
          .then(() => {
            setAudioReady(true);
            setAudioStatus("音声準備OK: 試合開始できます。名前読み上げも試します");

            // 名前読み上げはベストエフォート。
            // 読み上げが失敗しても、MP3再生準備を優先する。
            window.setTimeout(() => {
              speakMemberName(sampleMember, () => {});
            }, 300);
          })
          .catch((error) => {
            console.warn("音声準備に失敗しました:", error);
            setAudioReady(true);
            setAudioStatus("音声準備を試行しました。聞こえない場合はSafariで開くか、手動交代を一度押してください");
          });
      } else {
        setAudioReady(true);
        setAudioStatus("音声準備OK: 試合開始できます");
      }
    } catch (error) {
      console.warn("音声準備に失敗しました:", error);
      setAudioReady(true);
      setAudioStatus("音声準備を試行しました。聞こえない場合はSafariで開くか、手動交代を一度押してください");
    }
  }

  function testAudio() {
    prepareAudioForIOS();
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
    if (!audioReady) {
      setAudioStatus("音声準備未完了ですが開始します。音が出ない場合は手動交代を一度押してください");
      setAudioReady(true);
    }

    requestWakeLock();

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

  function resetBoard() {
    setBoardState(createInitialBoard(members));
  }

  function centerBall() {
    setBoardState((current) => ({
      ...current,
      ball: { ...current.ball, x: 50, y: 50 },
    }));
  }

  function updateBoardItem(type, id, nextPosition) {
    setBoardState((current) => {
      if (type === "ball") {
        return {
          ...current,
          ball: {
            ...current.ball,
            x: clamp(nextPosition.x, 2, 98),
            y: clamp(nextPosition.y, 3, 97),
          },
        };
      }

      const key = type === "own" ? "own" : "opponents";
      return {
        ...current,
        [key]: current[key].map((item) =>
          item.id === id
            ? {
                ...item,
                x: clamp(nextPosition.x, 4, 96),
                y: clamp(nextPosition.y, 5, 95),
              }
            : item
        ),
      };
    });
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
          <p className="eyebrow">しゃべる交代タイマー + 作戦ボード</p>
          <h1>はぜくん3号</h1>
          <p className="lead">ゴレイロ交代のタイミングと、試合中の作戦共有をサポートします。</p>
        </div>
        <div className={`status status-${status}`}>{statusLabel}</div>
      </header>

      <nav className="view-tabs" aria-label="画面切り替え">
        <button className={view === "timer" ? "tab-active" : ""} onClick={() => setView("timer")}>タイマー</button>
        <button className={view === "board" ? "tab-active" : ""} onClick={() => setView("board")}>作戦ボード</button>
      </nav>

      {view === "timer" ? (
        <>
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
          <button className="sound-ready" onClick={testAudio}>音声準備</button>
        </div>

        <div className="notice">
          <div>{audioStatus}</div>
          <div>{wakeLockStatus}</div>
          <div>iPhoneでは試合前に「音声準備」を押してください。LINE内ブラウザで不安定な場合は、右上の共有ボタンからSafariで開いてください。</div>
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
          <p className="helper">上から順にゴレイロを交代します。1行に1人ずつ入力してください。作戦ボードの黒丸にも反映されます。</p>
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
        </>
      ) : (
        <StrategyBoardView
          members={members}
          boardState={boardState}
          updateBoardItem={updateBoardItem}
          resetBoard={resetBoard}
          centerBall={centerBall}
          setView={setView}
        />
      )}
    </main>
  );
}

function StrategyBoardView({ members, boardState, updateBoardItem, resetBoard, centerBall, setView }) {
  return (
    <section className="strategy-layout">
      <section className="card board-info">
        <div>
          <h2>作戦ボード</h2>
          <p className="helper">
            黒丸が自チーム、白丸が相手、黄色がボールです。ドラッグまたは指で自由に動かせます。
            この配置はブラウザを開いている間だけ保持されます。
          </p>
        </div>
        <div className="board-actions">
          <button onClick={() => setView("timer")}>タイマーに戻る</button>
          <button onClick={resetBoard}>初期配置に戻す</button>
          <button onClick={centerBall}>ボール中央</button>
        </div>
      </section>

      <FutsalBoard
        ownPlayers={boardState.own}
        opponents={boardState.opponents}
        ball={boardState.ball}
        updateBoardItem={updateBoardItem}
      />

      <section className="card board-roster">
        <h2>作戦ボードのメンバー</h2>
        <div className="roster-grid">
          <div>
            <span className="legend-dot own-dot"></span>
            <strong>自チーム</strong>
            <ul>
              {members.map((member) => (
                <li key={member}>{member}</li>
              ))}
            </ul>
          </div>
          <div>
            <span className="legend-dot opponent-dot"></span>
            <strong>相手</strong>
            <ul>
              {DEFAULT_OPPONENTS.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </section>
  );
}

function FutsalBoard({ ownPlayers, opponents, ball, updateBoardItem }) {
  const boardRef = useRef(null);
  const dragRef = useRef(null);

  function toBoardPosition(event) {
    const rect = boardRef.current.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  }

  function handlePointerDown(event, item) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { id: item.id, type: item.type, pointerId: event.pointerId };
    updateBoardItem(item.type, item.id, toBoardPosition(event));
  }

  function handlePointerMove(event) {
    if (!dragRef.current) return;
    updateBoardItem(dragRef.current.type, dragRef.current.id, toBoardPosition(event));
  }

  function handlePointerUp(event) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  const pieces = [...ownPlayers, ...opponents, ball];

  return (
    <div
      className="futsal-board"
      ref={boardRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="court-line court-outline"></div>
      <div className="court-line center-line"></div>
      <div className="court-line center-circle"></div>
      <div className="court-line left-area"></div>
      <div className="court-line right-area"></div>
      <div className="court-line left-goal"></div>
      <div className="court-line right-goal"></div>
      <div className="court-label court-label-left">自陣</div>
      <div className="court-label court-label-right">相手陣</div>

      {pieces.map((item) => (
        <BoardPiece key={item.id} item={item} onPointerDown={handlePointerDown} />
      ))}
    </div>
  );
}

function BoardPiece({ item, onPointerDown }) {
  return (
    <button
      type="button"
      className={`board-piece piece-${item.type}`}
      style={{ left: `${item.x}%`, top: `${item.y}%` }}
      onPointerDown={(event) => onPointerDown(event, item)}
      aria-label={`${item.name}を移動`}
    >
      <span>{item.type === "ball" ? "⚽" : item.name}</span>
    </button>
  );
}

createRoot(document.getElementById("root")).render(<App />);
