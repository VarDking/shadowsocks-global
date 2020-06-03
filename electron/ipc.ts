import { mainWindow } from "./common";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { ipcMain as ipc } from "electron-better-ipc";
import { GFW_LIST_FILE_PATH, getAppState, getResourcesPath } from "./utils";
import { LOG_FILE_PATH, logger } from "./log";
import { FlowData } from "./flow";
import { ConnectionStatus } from "./routing_service";

ipc.answerRenderer(
  "getCustomizedRulesDirPath",
  async (defaultPath: unknown) => {
    try {
      if (mainWindow.get()) {
        const result = await dialog.showOpenDialog(
          mainWindow.get() as BrowserWindow,
          {
            defaultPath: defaultPath as string,
            properties: ["openDirectory"],
          }
        );
        if (result.canceled) return null;
        else return result.filePaths[0];
      }
    } catch (e) {
      return null;
    }
  }
);

ipc.answerRenderer("getResourcesPath", async () => await getResourcesPath());

ipc.answerRenderer("getAppVersion", async () => await app.getVersion());

ipcMain.on("setRunAtSystemStartup", () => {
  const appConfig = getAppState();
  if (appConfig.setting.general.runAtSystemStartup)
    app.setLoginItemSettings({ openAtLogin: true });
  else app.setLoginItemSettings({ openAtLogin: false });
});

ipcMain.on("openLogFile", () => {
  shell.openItem(LOG_FILE_PATH);
});

ipcMain.on("openGfwListFile", () => {
  shell.openItem(GFW_LIST_FILE_PATH);
});

ipcMain.on("hideWindow", () => {
  mainWindow.get()?.hide();
});

const sendToRender = (channel: string, data?: any) => {
  if (!mainWindow.get())
    logger.error(`received ${channel} channel but no mainWindow to notify`);
  else mainWindow.get()?.webContents.send(channel, data);
};

export const sendMessageToRender = (msg: string) => {
  sendToRender("proxy-message", msg);
};
export const sendUdpStatusToRender = (status: string) => {
  sendToRender("proxy-udpStatus", status);
};
export const sendFlowToRender = (data: FlowData & { time: number }) => {
  sendToRender("proxy-flow", data);
};
export const sendConnectionStatus = (status: ConnectionStatus) => {
  let statusString;
  switch (status) {
    case ConnectionStatus.CONNECTED:
      statusString = "connected";
      break;
    case ConnectionStatus.DISCONNECTED:
      statusString = "disconnected";
      break;
    case ConnectionStatus.RECONNECTING:
      statusString = "reconnecting";
      break;
    default:
      console.error(`Cannot send unknown proxy status: ${status}`);
      return;
  }
  const event = `proxy-${statusString}`;
  sendToRender(event);
};
