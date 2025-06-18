import * as vscode from "vscode";
import Timer from "./Timer";

interface CodingSession {
  language: string;
  wordsWritten: number;
  charactersWritten: number;
  linesWritten: number;
  timeSpent: number;
  fileName: string;
  timestamp: number;
}

interface DailyStats {
  date: string;
  totalTime: number;
  sessions: CodingSession[];
  languages: { [key: string]: number };
  totalWords: number;
  totalCharacters: number;
  totalLines: number;
}

let timer: Timer;
let inactivityTimeout: NodeJS.Timeout | undefined;
let currentSession: CodingSession | null = null;
let dailyStats: DailyStats;
let initialWordCount = 0;
let initialCharCount = 0;
let initialLineCount = 0;

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "ranky" is now active!');

  timer = new Timer();
  initializeDailyStats();

  const date = new Date();
  const currentTime = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
  // vscode.window.showInformationMessage(
  //   "Coding tracker activated at: " + currentTime
  // );

  // Listen for text document changes
  const textChangeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.contentChanges && e.contentChanges.length > 0) {
      handleUserCoding(e);
    }
  });

  const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) {
        handleEditorChange(editor);
      }
    }
  );

  // Command to show current session stats
  const showStatsCommand = vscode.commands.registerCommand(
    "ranky.showStats",
    () => {
      showCurrentStats();
    }
  );

  // Command to manually end session
  const endSessionCommand = vscode.commands.registerCommand(
    "ranky.endSession",
    () => {
      endCurrentSession();
      // vscode.window.showInformationMessage("Coding session ended manually");
    }
  );

  context.subscriptions.push(
    textChangeDisposable,
    editorChangeDisposable,
    showStatsCommand,
    endSessionCommand
  );
}

function initializeDailyStats() {
  const today = new Date().toISOString().split("T")[0];
  dailyStats = {
    date: today,
    totalTime: 0,
    sessions: [],
    languages: {},
    totalWords: 0,
    totalCharacters: 0,
    totalLines: 0,
  };
}

function handleUserCoding(e: vscode.TextDocumentChangeEvent) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !e.document) {
    return;
  }

  const language = e.document.languageId;
  const fileName = e.document.fileName;

  // Clear inactivity timeout
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
  }

  // Start new session if not running
  if (!timer.isRunning()) {
    startNewSession(language, fileName, editor);
  }

  // Set inactivity timeout (2 minutes for coding - longer than typing)
  inactivityTimeout = setTimeout(() => {
    endCurrentSession();
    console.log("Session ended due to 2 minutes of inactivity");
  }, 120000); // 2 minutes
}

function handleEditorChange(editor: vscode.TextEditor) {
  if (timer.isRunning() && currentSession) {
    const newLanguage = editor.document.languageId;
    const newFileName = editor.document.fileName;

    // If switching to a different language/file, end current session and start new one
    if (
      newLanguage !== currentSession.language ||
      newFileName !== currentSession.fileName
    ) {
      endCurrentSession();
      startNewSession(newLanguage, newFileName, editor);
    }
  }
}

function startNewSession(
  language: string,
  fileName: string,
  editor: vscode.TextEditor
) {
  // Count initial content
  const document = editor.document;
  initialWordCount = countWords(document.getText());
  initialCharCount = document.getText().length;
  initialLineCount = document.lineCount;

  currentSession = {
    language: language,
    wordsWritten: 0,
    charactersWritten: 0,
    linesWritten: 0,
    timeSpent: 0,
    fileName: fileName.split("/").pop() || "unknown",
    timestamp: Date.now(),
  };

  timer.start();
  console.log(
    `New coding session started: ${language} - ${currentSession.fileName}`
  );
}

function endCurrentSession() {
  if (!timer.isRunning() || !currentSession) {
    return;
  }

  // Calculate session metrics
  const sessionTime = timer.getElapsedSeconds();
  const editor = vscode.window.activeTextEditor;

  if (editor) {
    const document = editor.document;
    const finalWordCount = countWords(document.getText());
    const finalCharCount = document.getText().length;
    const finalLineCount = document.lineCount;

    currentSession.wordsWritten = Math.max(
      0,
      finalWordCount - initialWordCount
    );
    currentSession.charactersWritten = Math.max(
      0,
      finalCharCount - initialCharCount
    );
    currentSession.linesWritten = Math.max(
      0,
      finalLineCount - initialLineCount
    );
  }

  currentSession.timeSpent = sessionTime;

  // Update daily stats
  dailyStats.sessions.push(currentSession);
  dailyStats.totalTime += sessionTime;
  dailyStats.totalWords += currentSession.wordsWritten;
  dailyStats.totalCharacters += currentSession.charactersWritten;
  dailyStats.totalLines += currentSession.linesWritten;

  // Update language-specific time
  if (dailyStats.languages[currentSession.language]) {
    dailyStats.languages[currentSession.language] += sessionTime;
  } else {
    dailyStats.languages[currentSession.language] = sessionTime;
  }

  console.log(
    `Session ended: ${Math.round(sessionTime)}s, ${
      currentSession.wordsWritten
    } words, ${currentSession.language}`
  );

  timer.stop();
  currentSession = null;
}

function countWords(text: string): number {
  // More accurate word counting for code
  const codeWords = text
    .replace(/[{}();,.\[\]]/g, " ") // Replace common code symbols with spaces
    .replace(/\s+/g, " ") // Replace multiple spaces with single space
    .trim()
    .split(" ")
    .filter((word) => word.length > 0 && /[a-zA-Z0-9]/.test(word)); // Only count words with alphanumeric characters

  return codeWords.length;
}

function showCurrentStats() {
  const currentSessionTime = timer.isRunning() ? timer.getElapsedSeconds() : 0;
  const totalTime = dailyStats.totalTime + currentSessionTime;

  let statsMessage = `📊 Today's Coding Stats:\n`;
  statsMessage += `⏱️ Total Time: ${Math.round(totalTime)}s (${(
    totalTime / 60
  ).toFixed(1)}min)\n`;
  statsMessage += `📝 Words Written: ${dailyStats.totalWords}\n`;
  statsMessage += `📄 Lines Added: ${dailyStats.totalLines}\n`;
  statsMessage += `🔤 Characters: ${dailyStats.totalCharacters}\n`;
  statsMessage += `📁 Sessions: ${dailyStats.sessions.length}\n`;

  if (Object.keys(dailyStats.languages).length > 0) {
    statsMessage += `\n🚀 Languages:\n`;
    Object.entries(dailyStats.languages)
      .sort(([, a], [, b]) => b - a)
      .forEach(([lang, time]) => {
        statsMessage += `  ${lang}: ${(time / 60).toFixed(1)}min\n`;
      });
  }

  // vscode.window.showInformationMessage(statsMessage);
}

function calculateProductivityScore(): number {
  // Simple productivity score based on words per minute and consistency
  const totalMinutes = dailyStats.totalTime / 60;
  if (totalMinutes === 0) {
    return 0;
  }

  const wordsPerMinute = dailyStats.totalWords / totalMinutes;
  const sessionConsistency =
    dailyStats.sessions.length > 0
      ? dailyStats.sessions.filter((s) => s.timeSpent > 300).length /
        dailyStats.sessions.length
      : 0; // Sessions > 5min

  return Math.round(wordsPerMinute * 10 + sessionConsistency * 50);
}

export async function deactivate() {
  // End current session if active
  if (timer && timer.isRunning()) {
    endCurrentSession();
  }

  // Clean up timeout
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
  }

  const productivityScore = calculateProductivityScore();
  const payload = {
    date: dailyStats.date,
    totalTimeSeconds: dailyStats.totalTime,
    totalTimeMinutes: Math.round((dailyStats.totalTime / 60) * 100) / 100,
    totalWords: dailyStats.totalWords,
    totalCharacters: dailyStats.totalCharacters,
    totalLines: dailyStats.totalLines,
    sessionsCount: dailyStats.sessions.length,
    languages: dailyStats.languages,
    productivityScore: productivityScore,
    sessions: dailyStats.sessions.map((session) => ({
      language: session.language,
      fileName: session.fileName,
      timeSpent: session.timeSpent,
      wordsWritten: session.wordsWritten,
      linesWritten: session.linesWritten,
      timestamp: session.timestamp,
    })),
    // GitHub-style contribution data
    githubContribution: {
      date: dailyStats.date,
      count: Math.min(Math.round(dailyStats.totalTime / 300), 10), // Max 10 for very productive days (5min = 1 point)
      level: Math.min(Math.floor(dailyStats.totalTime / 1800), 4), // 0-4 levels (30min intervals)
    },
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
