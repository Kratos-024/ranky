import * as vscode from "vscode";
import Timer from "./Timer";

interface DailyStats {
  date: string;
  totalTime: number;
  totalWords: number;
  totalLines: number;
  languages: Set<string>;
}

interface GitHubUser {
  login: string;
  id: number;
  email: string | null;
  name?: string;
  avatar_url?: string;
  token: string;
  [key: string]: any;
}

let timer: Timer;
let inactivityTimeout: NodeJS.Timeout | undefined;
let dailyStats: DailyStats;
let isTracking = false;
let githubUser: GitHubUser | null = null;

const FIRST_TIME_SETUP_KEY = "ranky.firstTimeSetup";

async function authenticateWithGitHub(): Promise<GitHubUser | null> {
  try {
    const session = await vscode.authentication.getSession(
      "github",
      ["read:user", "user:email"],
      { createIfNone: true }
    );

    if (!session) {
      throw new Error("Failed to authenticate with GitHub");
    }

    const token = session.accessToken;

    const userInfoResponse = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!userInfoResponse.ok) {
      throw new Error(`GitHub API error: ${userInfoResponse.status}`);
    }

    const userInfo = (await userInfoResponse.json()) as GitHubUser;

    const githubUserData: GitHubUser = {
      login: userInfo.login,
      id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      avatar_url: userInfo.avatar_url,
      token: token,
    };

    return githubUserData;
  } catch (error) {
    console.error("GitHub authentication failed:", error);
    vscode.window.showErrorMessage(`GitHub Authentication failed: ${error}`);
    return null;
  }
}

async function createUserStatsOnFirstInstall(context: vscode.ExtensionContext) {
  try {
    // Check if this is the first time the extension is running
    const hasRunBefore = context.globalState.get(FIRST_TIME_SETUP_KEY, false);

    if (hasRunBefore) {
      console.log("Extension has already been initialized before");
      return;
    }

    if (!githubUser) {
      console.error("No GitHub user data available for first-time setup");
      return;
    }

    const today = new Date().toISOString().split("T")[0];

    const payload = {
      name: githubUser.name || githubUser.login,
      username: githubUser.login,
      uniqueId: githubUser.id.toString(),
      email: githubUser.email || "",
      date: today,
    };

    console.log("Creating user stats for first-time installation:", payload);

    const response = await makeSecureRequest(
      "http://localhost:8000/api/v1/extension/create-stats",
      { payload: payload }
    );

    if (response) {
      console.log("✅ Successfully created user account and stats");

      // Mark that the extension has been set up
      await context.globalState.update(FIRST_TIME_SETUP_KEY, true);

      vscode.window.showInformationMessage(
        "🎉 Welcome to Ranky! Your coding stats tracking has been set up successfully."
      );
    } else {
      console.log("❌ Failed to create user stats");
      vscode.window.showWarningMessage(
        "Failed to set up your coding stats. Please try restarting VS Code."
      );
    }
  } catch (error) {
    console.error("Error during first-time setup:", error);
    vscode.window.showErrorMessage(
      "Error occurred during setup. Please check your internet connection and try again."
    );
  }
}

async function makeSecureRequest(endpoint: string, data: any = null) {
  if (!githubUser) {
    console.error("No GitHub user data available");
    return null;
  }

  const requestBody = {
    ...data,
    github: {
      token: githubUser.token,
      username: githubUser.login,
      email: githubUser.email,
      id: githubUser.id,
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: data ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${githubUser.token}`,
      },
      body: data ? JSON.stringify(requestBody) : undefined,
    });

    if (response.status === 401) {
      // Token expired, re-authenticate
      console.log("Token expired, re-authenticating...");
      githubUser = await authenticateWithGitHub();
      if (githubUser) {
        // Retry the request with new token
        return makeSecureRequest(endpoint, data);
      }
      return null;
    }

    return response.json();
  } catch (error) {
    console.error("Request failed:", error);
    return null;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "ranky" is now active!');

  // Authenticate with GitHub and get user data
  githubUser = await authenticateWithGitHub();

  if (githubUser) {
    vscode.window.showInformationMessage(
      `✅ Authenticated as ${githubUser.login} (${
        githubUser.email || "No email"
      })`
    );
    console.log("GitHub user data:", {
      username: githubUser.login,
      email: githubUser.email,
      id: githubUser.id,
      tokenPrefix: githubUser.token.substring(0, 10) + "...",
    });

    // Call first-time setup after successful authentication
    await createUserStatsOnFirstInstall(context);
  } else {
    vscode.window.showErrorMessage("❌ GitHub Authentication failed.");
    return; // Exit if authentication fails
  }

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

  // Command to refresh GitHub authentication
  const refreshAuthCommand = vscode.commands.registerCommand(
    "ranky.refreshAuth",
    async () => {
      githubUser = await authenticateWithGitHub();
      if (githubUser) {
        vscode.window.showInformationMessage(
          `✅ Re-authenticated as ${githubUser.login} (${
            githubUser.email || "No email"
          })`
        );
      }
    }
  );

  context.subscriptions.push(
    textChangeDisposable,
    showStatsCommand,
    refreshAuthCommand
  );
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
  statsMessage += `👤 User: ${githubUser?.login || "Unknown"}\n`;
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

  if (!githubUser) {
    console.log("No GitHub user data available for sending stats");
    return;
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

  console.log("Sending daily coding stats with GitHub user data:", {
    payload,
    token: githubUser.token,
    user: githubUser.login,
    email: githubUser.email,
  });

  try {
    const response = await makeSecureRequest(
      "http://localhost:8000/api/v1/extension/coding-stats",
      { payload: payload }
    );

    if (response) {
      console.log("Successfully sent coding stats to endpoint");
    } else {
      console.log("Failed to send coding stats");
    }
  } catch (error) {
    console.log("Error sending coding stats:", error);
  }
}
