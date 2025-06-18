import * as vscode from "vscode";
import Timer from "./Timer";

interface DailyStats {
  date: string;
  totalTime: number;
  totalWords: number;
  totalLines: number;
  languages: Set<string>;
}

let timer: Timer;
let inactivityTimeout: NodeJS.Timeout | undefined;
let dailyStats: DailyStats;
let isTracking = false;

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "ranky" is now active!');

  timer = new Timer();
  initializeDailyStats();

  const textChangeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.contentChanges && e.contentChanges.length > 0) {
      handleUserCoding(e);
    }
  });

  const showStatsCommand = vscode.commands.registerCommand(
    "ranky.showStats",
    () => {
      showCurrentStats();
    }
  );

  context.subscriptions.push(textChangeDisposable, showStatsCommand);
}

function initializeDailyStats() {
  const today = new Date().toISOString().split("T")[0];
  dailyStats = {
    date: today,
    totalTime: 0,
    totalWords: 0,
    totalLines: 0,
    languages: new Set<string>(),
  };
}

function handleUserCoding(e: vscode.TextDocumentChangeEvent) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !e.document) {
    return;
  }

  const language = e.document.languageId;

  dailyStats.languages.add(language);

  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
  }

  if (!timer.isRunning()) {
    timer.start();
    isTracking = true;
    console.log("Started tracking coding session");
  }

  e.contentChanges.forEach((change) => {
    const newLines = (change.text.match(/\n/g) || []).length;
    if (newLines > 0) {
      dailyStats.totalLines += newLines;
    }

    if (change.text.length > 0 && change.rangeLength === 0) {
      const hasContent = change.text.trim().length > 0;
      if (hasContent && !change.text.includes("\n")) {
        const words = change.text
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0);
        dailyStats.totalWords += words.length;
      }
    }
  });

  inactivityTimeout = setTimeout(() => {
    endSession();
    console.log("Session ended due to 2 minutes of inactivity");
  }, 120000);
}

function endSession() {
  if (timer.isRunning()) {
    const sessionTime = timer.getElapsedSeconds();
    dailyStats.totalTime += sessionTime;
    timer.stop();
    isTracking = false;
    console.log(`Session ended: ${Math.round(sessionTime)}s`);
  }

  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = undefined;
  }
}

function showCurrentStats() {
  const currentSessionTime = timer.isRunning() ? timer.getElapsedSeconds() : 0;
  const totalTime = dailyStats.totalTime + currentSessionTime;

  let statsMessage = `📊 Today's Coding Stats:\n`;
  statsMessage += `⏱️ Total Time: ${Math.round(totalTime)}s (${(
    totalTime / 60
  ).toFixed(1)}min)\n`;
  statsMessage += `📝 Total Words: ${dailyStats.totalWords}\n`;
  statsMessage += `📄 Total Lines: ${dailyStats.totalLines}\n`;
  statsMessage += `🚀 Languages: ${Array.from(dailyStats.languages).join(
    ", "
  )}\n`;

  vscode.window.showInformationMessage(statsMessage);
}

export async function deactivate() {
  if (timer && timer.isRunning()) {
    endSession();
  }

  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
  }

  const languagesArray = Array.from(dailyStats.languages);

  const payload = {
    date: dailyStats.date,
    totalTimeSeconds: dailyStats.totalTime,
    totalTimeMinutes: Math.round((dailyStats.totalTime / 60) * 100) / 100,
    totalWords: dailyStats.totalWords,
    totalLines: dailyStats.totalLines,
    languages: languagesArray,
  };

  console.log("Sending daily coding stats:", payload);

  try {
    const response = await fetch(
      "http://localhost:8000/api/v1/users/coding-stats",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payload: payload }),
      }
    );

    if (response.ok) {
      console.log("Successfully sent coding stats to endpoint");
    } else {
      console.log("Failed to send coding stats:", response.status);
    }
  } catch (error) {
    console.log("Error sending coding stats:", error);
  }
}
