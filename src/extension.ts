import * as vscode from "vscode";
import Timer from "./Timer";
import { Jwt, verify } from "jsonwebtoken";

interface DailyStats {
  date: string;
  totalTimeMinutes: number;
  totalWords: number;
  totalLines: number;
  languages: Set<string>;
}

interface RankyUser {
  name: string;
  userId: string;
  email: string;
  username: string;
  [key: string]: any;
}
interface UserAccountCreated {
  userId: string;
  email: string;
  username: string;
  userCreated: boolean;
  [key: string]: any;
}

interface TokenPayload {
  userId: string;
  email: string;
  username: string;
  iat?: number;
  exp?: number;
  [key: string]: any;
  bio: string;
  fullName: string;
}

interface CodingStatsPayload {
  email: string;
  uniqueId: string;
  date: string;
  totalTimeMinutes: number;
  totalWords: number;
  totalLines: number;
  languages: string[];
  sessionEndReason: "vscode_close" | "inactivity";
}

interface VerifyAuthResponse {
  success: boolean;
  userId?: string;
  message?: string;
}

interface WebViewMessage {
  command: string;
  token?: string;
  error?: string;
}

let timer: Timer;
let inactivityTimeout: NodeJS.Timeout | undefined;
let dailyStats: DailyStats;
let isTracking = false;
let rankyUser: RankyUser | null = null;
let currentPanel: vscode.WebviewPanel | undefined = undefined;
let statsAlreadySent = false; // Flag to prevent duplicate stats sending

const RANKY_AUTH_KEY = "ranky-user-auth";
const RANKY_TOKEN_KEY = "ranky-auth-token";

function parseJWT(token: string): TokenPayload | null {
  try {
    const parsedToken = verify(token, "KGoBTHBZ9Ss3GoOROv23li85Y3yFVTDbiodF");
    return JSON.parse(JSON.stringify(parsedToken));
  } catch (error) {
    console.error("Error parsing JWT:", error);
    return null;
  }
}

async function verifyAuthWithBackend(userId: string): Promise<boolean> {
  try {
    const response = await fetch(
      "http://localhost:8000/api/v1/users/verify-extension-auth",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      }
    );
    const data = (await response.json()) as VerifyAuthResponse;

    if (response.status === 200) {
      return data.success === true;
    }

    return false;
  } catch (error) {
    console.error("Backend verification failed:", error);
    return false;
  }
}

async function sendCodingStatsToBackend(
  statsData: CodingStatsPayload
): Promise<boolean> {
  try {
    const response = await fetch(
      "http://localhost:8000/api/v1/extension/coding-stats",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payload: statsData }),
      }
    );

    if (response.ok) {
      console.log("Coding stats sent successfully");
      return true;
    } else {
      console.error(
        "Failed to send coding stats:",
        response.status,
        response.statusText
      );
      return false;
    }
  } catch (error) {
    console.error("Error sending coding stats to backend:", error);
    return false;
  }
}

function getWebviewContent(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ranky Authentication</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        'ranky-blue': '#3B82F6',
                        'ranky-dark': '#1E293B',
                        'ranky-gray': '#64748B',
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 min-h-screen flex items-center justify-center p-4">
    <div class="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8 w-full max-w-md border border-white/20">
        <!-- Header -->
        <div class="text-center mb-8">
            <div class="bg-gradient-to-r from-blue-500 to-purple-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                </svg>
            </div>
            <h1 class="text-2xl font-bold text-white mb-2">Ranky Authentication</h1>
            <p class="text-blue-200 text-sm">Enter your JWT token to connect your account</p>
        </div>

        <!-- Form -->
        <form id="tokenForm" class="space-y-6">
            <div>
                <label for="token" class="block text-sm font-medium text-blue-200 mb-2">
                    Authentication Token
                </label>
                <textarea 
                    id="token" 
                    name="token" 
                    rows="4" 
                    class="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none backdrop-blur-sm"
                    placeholder="Paste your JWT token here..."
                    required
                ></textarea>
                <p class="text-xs text-blue-300 mt-2">
                    Copy the complete token from your Ranky dashboard
                </p>
            </div>

            <!-- Error Message -->
            <div id="errorMessage" class="hidden bg-red-500/20 border border-red-500/30 text-red-200 px-4 py-3 rounded-lg text-sm">
                <div class="flex items-center">
                    <svg class="w-4 h-4 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
                    </svg>
                    <span id="errorText"></span>
                </div>
            </div>

            <!-- Success Message -->
            <div id="successMessage" class="hidden bg-green-500/20 border border-green-500/30 text-green-200 px-4 py-3 rounded-lg text-sm">
                <div class="flex items-center">
                    <svg class="w-4 h-4 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
                    </svg>
                    <span>Authentication successful! You can close this panel.</span>
                </div>
            </div>

            <!-- Loading State -->
            <div id="loadingMessage" class="hidden bg-blue-500/20 border border-blue-500/30 text-blue-200 px-4 py-3 rounded-lg text-sm">
                <div class="flex items-center">
                    <svg class="animate-spin w-4 h-4 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Verifying token...</span>
                </div>
            </div>

            <!-- Buttons -->
            <div class="flex space-x-4">
                <button 
                    type="submit" 
                    id="submitBtn"
                    class="flex-1 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium py-3 px-4 rounded-lg hover:from-blue-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-transparent transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                    Authenticate
                </button>
                <button 
                    type="button" 
                    id="cancelBtn"
                    class="px-6 py-3 bg-white/10 text-white font-medium rounded-lg hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 transition-all duration-200 border border-white/20"
                >
                    Cancel
                </button>
            </div>
        </form>

        <!-- Footer -->
        <div class="mt-8 text-center">
            <p class="text-xs text-blue-300">
                Don't have a token? 
                <a href="#" id="helpLink" class="text-blue-400 hover:text-blue-300 underline">
                    Get one from your Ranky dashboard
                </a>
            </p>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Form elements
        const form = document.getElementById('tokenForm');
        const tokenInput = document.getElementById('token');
        const submitBtn = document.getElementById('submitBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorMessage = document.getElementById('errorMessage');
        const successMessage = document.getElementById('successMessage');
        const loadingMessage = document.getElementById('loadingMessage');
        const errorText = document.getElementById('errorText');
        const helpLink = document.getElementById('helpLink');

        // Utility functions
        function showMessage(type, message = '') {
            hideAllMessages();
            if (type === 'error') {
                errorText.textContent = message;
                errorMessage.classList.remove('hidden');
            } else if (type === 'success') {
                successMessage.classList.remove('hidden');
            } else if (type === 'loading') {
                loadingMessage.classList.remove('hidden');
            }
        }

        function hideAllMessages() {
            errorMessage.classList.add('hidden');
            successMessage.classList.add('hidden');
            loadingMessage.classList.add('hidden');
        }

        function validateToken(token) {
            if (!token || token.trim().length === 0) {
                return { valid: false, message: 'Token cannot be empty' };
            }
            
            const parts = token.trim().split('.');
            if (parts.length !== 3) {
                return { valid: false, message: 'Invalid token format. Please ensure you copied the complete token.' };
            }
            
            return { valid: true };
        }

        function setButtonState(disabled) {
            submitBtn.disabled = disabled;
            if (disabled) {
                submitBtn.textContent = 'Processing...';
            } else {
                submitBtn.textContent = 'Authenticate';
            }
        }

        // Event handlers
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const token = tokenInput.value.trim();
            const validation = validateToken(token);
            
            if (!validation.valid) {
                showMessage('error', validation.message);
                return;
            }
            
            setButtonState(true);
            showMessage('loading');
            
            // Send token to extension
            vscode.postMessage({
                command: 'submitToken',
                token: token
            });
        });

        cancelBtn.addEventListener('click', () => {
            vscode.postMessage({
                command: 'cancel'
            });
        });

        helpLink.addEventListener('click', (e) => {
            e.preventDefault();
            vscode.postMessage({
                command: 'openHelp'
            });
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'tokenResult':
                    setButtonState(false);
                    if (message.success) {
                        showMessage('success');
                        setTimeout(() => {
                            vscode.postMessage({ command: 'close' });
                        }, 2000);
                    } else {
                        showMessage('error', message.error || 'Authentication failed');
                    }
                    break;
            }
        });

        // Auto-focus token input
        tokenInput.focus();
    </script>
</body>
</html>`;
}

function createTokenWebView(
  context: vscode.ExtensionContext
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    "rankyAuth",
    "Ranky Authentication",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    }
  );

  panel.webview.html = getWebviewContent();

  panel.webview.onDidReceiveMessage(
    async (message: WebViewMessage) => {
      switch (message.command) {
        case "submitToken":
          if (message.token) {
            const result = await processTokenFromWebView(
              message.token,
              context
            );
            panel.webview.postMessage({
              command: "tokenResult",
              success: result.success,
              error: result.error,
            });
          }
          break;

        case "cancel":
          panel.dispose();
          break;

        case "close":
          panel.dispose();
          break;

        case "openHelp":
          vscode.env.openExternal(
            vscode.Uri.parse("https://your-ranky-dashboard.com/tokens")
          );
          break;
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(() => {
    currentPanel = undefined;
  });

  return panel;
}
const createUserAccountFromExtensionSide = async (
  email: string,
  uniqueId: string,
  name: string
) => {
  try {
    const newDate = new Date();
    const today = `${newDate.getFullYear()}-${
      newDate.getMonth() < 10 ? `0${newDate.getMonth()}` : newDate.getMonth()
    }-${newDate.getDate() < 10 ? `0${newDate.getDate()}` : newDate.getDate()}`;

    const payload = {
      email,
      uniqueId,
      date: today,
      name: name,
    };
    const response = await fetch(
      "http://localhost:8000/api/v1/extension/create-stats",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload,
        }),
      }
    );
    const data = (await response.json()) as {
      statusCode: number;
      success: boolean;
      message: string;
      data: string;
    };
    if (!data.success) {
      vscode.window.showErrorMessage(
        "Failed to Create account during extension startup. You can retry using the 'Ranky: Enter Token' command."
      );
      throw new Error(
        "Authentication error during createUserAccountFromExtensionSide"
      );
    }
    return true;
  } catch (error) {
    console.error(
      "Authentication error during createUserAccountFromExtensionSide:",
      error
    );
    vscode.window.showErrorMessage(
      "Failed to Create account during extension startup. You can retry using the 'Ranky: Enter Token' command."
    );
    return false;
  }
};
async function processTokenFromWebView(
  token: string,
  context: vscode.ExtensionContext
): Promise<{ success: boolean; error?: string }> {
  try {
    await clearAuthenticationData(context);

    const payload = parseJWT(token);
    if (!payload) {
      return { success: false, error: "Invalid token format or signature" };
    }

    const isVerified = await verifyAuthWithBackend(payload.userId);
    if (!isVerified) {
      return { success: false, error: "Token verification failed with server" };
    }

    const userData: RankyUser = {
      userId: payload.userId,
      email: payload.email,
      username: payload.userName,
      name: payload.fullName,
    };
    const created = await createUserAccountFromExtensionSide(
      userData.email,
      userData.userId,
      userData.name
    );
    if (created) {
      const newUserData = {
        email: userData.email,
        username: userData.username,
        userId: userData.userId,
        userCreated: true,
      };
      await context.secrets.store(RANKY_AUTH_KEY, JSON.stringify(newUserData));
      await context.secrets.store(RANKY_TOKEN_KEY, token);

      rankyUser = userData;

      vscode.window.showInformationMessage(
        `✅ Successfully authenticated as ${
          userData.username || userData.userId
        }`
      );

      return { success: true };
    }
    throw new Error(
      "Something went wrong during processing Token from web view"
    );
  } catch (error: any) {
    console.error("Token processing failed:", error);
    return { success: false, error: error.message || "Authentication failed" };
  }
}

async function showTokenWebView(
  context: vscode.ExtensionContext
): Promise<void> {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  currentPanel = createTokenWebView(context);
}

async function authenticateWithToken(
  context: vscode.ExtensionContext
): Promise<RankyUser | null> {
  try {
    const storedUser = await context.secrets.get(RANKY_AUTH_KEY);
    const storedToken = await context.secrets.get(RANKY_TOKEN_KEY);
    vscode.window.showInformationMessage(`${storedUser}`);
    if (storedUser && storedToken) {
      try {
        const userData = JSON.parse(storedUser);

        const isValid = await verifyAuthWithBackend(userData.userId);
        if (isValid) {
          return userData;
        } else {
          await context.secrets.delete(RANKY_AUTH_KEY);
          await context.secrets.delete(RANKY_TOKEN_KEY);
        }
      } catch (error) {
        console.error("Error parsing stored user data:", error);
        await context.secrets.delete(RANKY_AUTH_KEY);
        await context.secrets.delete(RANKY_TOKEN_KEY);
      }
    }

    await showTokenWebView(context);
    return null;
  } catch (error: any) {
    console.error("Token authentication failed:", error);
    vscode.window.showErrorMessage(
      `Authentication failed: ${error.message || "Unknown error occurred"}`
    );
    return null;
  }
}

async function clearAuthenticationData(context: vscode.ExtensionContext) {
  try {
    await context.secrets.delete(RANKY_AUTH_KEY);
    await context.secrets.delete(RANKY_TOKEN_KEY);
    rankyUser = null;
    console.log("Authentication data cleared");
  } catch (error) {
    console.error("Error clearing authentication data:", error);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push({
    dispose: () => {
      if (timer && timer.isRunning()) {
        endSession();
      }
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
      }
      if (currentPanel) {
        currentPanel.dispose();
      }
      rankyUser = null;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    rankyUser = await authenticateWithToken(context);

    if (rankyUser) {
      vscode.window.showInformationMessage(
        `✅ Authenticated as ${rankyUser.username || rankyUser.userId} ${
          rankyUser.email ? `(${rankyUser.email})` : ""
        }`
      );
    } else {
      vscode.window.showWarningMessage("❌ Ranky Authentication required.");
      vscode.window.showInformationMessage(
        "Please complete authentication in the opened panel or use 'Ranky: Enter Token' command later."
      );
    }
  } catch (error) {
    console.error("Authentication error during activation:", error);
    vscode.window.showErrorMessage(
      "Failed to authenticate during extension startup. You can retry using the 'Ranky: Enter Token' command."
    );
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

  const refreshAuthCommand = vscode.commands.registerCommand(
    "ranky.refreshAuth",
    async () => {
      try {
        vscode.window.showInformationMessage("Opening authentication panel...");

        await showTokenWebView(context);
      } catch (error) {
        console.error("Manual authentication failed:", error);
        vscode.window.showErrorMessage("Failed to open authentication panel.");
      }
    }
  );

  const clearAuthCommand = vscode.commands.registerCommand(
    "ranky.clearAuth",
    async () => {
      try {
        await clearAuthenticationData(context);
        vscode.window.showInformationMessage(
          "Authentication data cleared. Use 'Ranky: Enter Token' to re-authenticate."
        );
      } catch (error) {
        console.error("Error clearing authentication:", error);
        vscode.window.showErrorMessage("Failed to clear authentication data.");
      }
    }
  );

  const enterTokenCommand = vscode.commands.registerCommand(
    "ranky.enterToken",
    async () => {
      try {
        await showTokenWebView(context);
      } catch (error) {
        console.error("Token entry failed:", error);
        vscode.window.showErrorMessage("Failed to open authentication panel.");
      }
    }
  );

  context.subscriptions.push(
    textChangeDisposable,
    showStatsCommand,
    refreshAuthCommand,
    clearAuthCommand,
    enterTokenCommand
  );
}

function initializeDailyStats() {
  const today = new Date().toISOString().split("T")[0];
  dailyStats = {
    date: today,
    totalTimeMinutes: 0,
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

  // Changed from 120000 (2 minutes) to 1800000 (30 minutes)
  inactivityTimeout = setTimeout(() => {
    endSession();
    console.log("Session ended due to 30 minutes of inactivity");
  }, 1800000);
}

function endSession() {
  if (timer.isRunning()) {
    const sessionTime = timer.getElapsedSeconds();
    dailyStats.totalTimeMinutes += sessionTime;
    timer.stop();
    isTracking = false;
    console.log(`Session ended: ${Math.round(sessionTime)}s`);

    // Only send stats if they haven't been sent already
    if (rankyUser && dailyStats.totalTimeMinutes > 0 && !statsAlreadySent) {
      statsAlreadySent = true;
      const statsPayload: CodingStatsPayload = {
        email: rankyUser.email,
        uniqueId: rankyUser.userId,
        date: dailyStats.date,
        totalTimeMinutes: dailyStats.totalTimeMinutes,
        totalWords: dailyStats.totalWords,
        totalLines: dailyStats.totalLines,
        languages: Array.from(dailyStats.languages),
        sessionEndReason: "inactivity",
      };

      sendCodingStatsToBackend(statsPayload).catch((error) => {
        console.error("Failed to send inactivity stats:", error);
      });
    }
  }

  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = undefined;
  }
}

function showCurrentStats() {
  const currentSessionTime = timer.isRunning() ? timer.getElapsedSeconds() : 0;
  const totalTime = dailyStats.totalTimeMinutes + currentSessionTime;

  let statsMessage = `📊 Today's Coding Stats:\n`;
  statsMessage += `👤 User: ${
    rankyUser?.username || rankyUser?.userId || "Unknown"
  }\n`;
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
  try {
    if (timer && timer.isRunning()) {
      endSession();
    }

    if (inactivityTimeout) {
      clearTimeout(inactivityTimeout);
    }

    if (currentPanel) {
      currentPanel.dispose();
    }

    // Only send stats if they haven't been sent already
    if (
      rankyUser &&
      dailyStats &&
      dailyStats.totalTimeMinutes > 0 &&
      !statsAlreadySent
    ) {
      statsAlreadySent = true;
      const statsPayload: CodingStatsPayload = {
        email: rankyUser.email,
        uniqueId: rankyUser.userId,
        date: dailyStats.date,
        totalTimeMinutes: dailyStats.totalTimeMinutes,
        totalWords: dailyStats.totalWords,
        totalLines: dailyStats.totalLines,
        languages: Array.from(dailyStats.languages),
        sessionEndReason: "vscode_close",
      };

      console.log("Sending final coding stats on VSCode close...");
      await sendCodingStatsToBackend(statsPayload);
    }

    rankyUser = null;
  } catch (error) {
    console.error("Error during deactivation:", error);
  }
}
