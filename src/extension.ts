import * as vscode from "vscode";
export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "ranky" is now active!');

  //   const disposable1 = vscode.commands.registerCommand(
  //     "ranky.helloWorld",
  //     () => {
  //       vscode.window.showInformationMessage(
  //         "Hello World From my first extension"
  //       );
  //     }
  //   );
  //   const date = new Date();
  //   const currentTime = `${date.getHours()}::${date.getMinutes()}::${date.getSeconds()}`;
  //   vscode.window.showInformationMessage("The time is,", currentTime);

  //   //   const disposable2 = vscode.commands.registerCommand("ranky.ranky", () => {
  //   //     vscode.window.showInformationMessage(
  //   //       "Hello World From my first extension2"
  //   //     );
  //   //   });

  const date = new Date();
  const currentTime = `${date.getHours()}::${date.getMinutes()}::${date.getSeconds()}`;
  vscode.window.showInformationMessage("The time is,", currentTime);
  // vscode.workspace.onDidChangeTextDocument((e) => {
  //   const startPos = new vscode.Position(1, 0);
  //   const endPos = new vscode.Position(10, 0);
  //   const textRange = new vscode.Range(startPos, endPos);

  //   const text = e.document.getText(textRange);

  //   vscode.window.showInformationMessage(`Code between lines 1–10:\n${text}`);
  // });
  vscode.workspace.onDidChangeTextDocument((e) => {
    if (!e.contentChanges) {
      vscode.window.showInformationMessage(`Code between lines 1–10`);
    }
  });
  const showTime = vscode.commands.registerCommand("ranky.showTime", () => {});

  context.subscriptions.push(showTime);
}

export async function deactivate() {
  try {
    await fetch("http://localhost:8000/api/v1/users/getTheMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "Hello hhue hiue" }),
    });
  } catch (error) {
    console.log("ERRir", error);
  }
}
