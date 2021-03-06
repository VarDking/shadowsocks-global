import { app, Menu } from "electron";
import path from "path";
import { getActivatedServer } from "./share";
import Store from "electron-store";
import { AppState } from "../reducers/rootReducer";
import { mainWindow } from "./common";
import fs from "fs";
import dns from "dns";
import maxmind, { CountryResponse } from "maxmind";

const appConfig = new Store();
export const getAppState = () => appConfig.get("state") as AppState;

export const setMenu = () => {
  if (process.env.NODE_ENV === "development") {
    mainWindow.get()?.webContents.on("context-menu", (e, props) => {
      const { x, y } = props;
      Menu.buildFromTemplate([
        {
          label: "Inspect element",
          click: () => {
            mainWindow.get()?.webContents.inspectElement(x, y);
          },
        },
      ]).popup({ window: mainWindow.get() });
    });
  } else {
    mainWindow.get()?.removeMenu();
  }
};

export const installExtensions = async () => {
  const devtoolsInstaller = require("electron-devtools-installer");
  const extensions = [
    devtoolsInstaller.REACT_DEVELOPER_TOOLS,
    devtoolsInstaller.REDUX_DEVTOOLS,
  ];
  await Promise.all(extensions.map((name) => devtoolsInstaller.default(name)));
};

export interface RemoteServer {
  type: "shadowsocks";
  host: string;
  port: number;

  name?: string;

  method: string;
  password: string;

  plugin?: string;
  plugin_opts?: string;
}
export const isDev = process.env.NODE_ENV === "development";

export const getResourcesPath = () => {
  const appPath = app.getAppPath();
  return isDev ? appPath : appPath.replace("app.asar", "app.asar.unpacked");
};
export const getBuildInRuleDirPath = () =>
  path.join(getResourcesPath(), "rule");

export const getBuildInRulePaths = async () => {
  const dirPath = getBuildInRuleDirPath();
  const paths: string[] = [];
  const buildInRules = await fs.promises.readdir(dirPath);
  buildInRules.forEach((rule) => {
    if (path.extname(rule) === ".json") paths.push(path.join(dirPath, rule));
  });
  return paths;
};
export const getBuildInRules = async () => {
  const paths = await getBuildInRulePaths();
  return paths.map((p) => path.basename(p, ".json"));
};
export function pathToEmbeddedBinary(toolName: string, filename: string) {
  return path.join(
    getResourcesPath(),
    "third_party",
    toolName,
    filename + ".exe"
  );
}

const DNS_LOOKUP_TIMEOUT_MS = 2000;

export function timeoutPromise<T = any>(
  promise: Promise<any>,
  ms: number,
  name = ""
): Promise<T> {
  let winner: Promise<any>;
  const timeout = new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearTimeout(timeoutId);
      if (winner) {
        console.log(`Promise "${name}" resolved before ${ms} ms.`);
        resolve();
      } else {
        console.log(`Promise "${name}" timed out after ${ms} ms.`);
        reject("Promise timeout");
      }
    }, ms);
  });
  winner = Promise.race([promise, timeout]);
  return winner;
}

// Effectively a no-op if hostname is already an IP.
export function lookupIp(hostname: string) {
  return timeoutPromise<string>(
    new Promise<string>((fulfill, reject) => {
      dns.lookup(hostname, 4, (e, address) => {
        if (e || !address) {
          return reject("could not resolve proxy server hostname");
        }
        fulfill(address);
      });
    }),
    DNS_LOOKUP_TIMEOUT_MS,
    "DNS lookup"
  );
}

export class Config {
  private state = getAppState();

  getIsDnsOverUdp = () => {
    return this.state.setting.general.dnsOverUdp;
  };

  getDns = () => this.state.setting.dns;
  getRule = async () => {
    const ruleName = this.state.setting.rule.current;
    const buildInRulePaths = await getBuildInRulePaths();
    let ruleFilePath = buildInRulePaths.find(
      (rulePath) => path.basename(rulePath, ".json") === ruleName
    );
    if (!ruleFilePath) throw new Error("Fail to find the file");
    return ruleFilePath;
  };

  getProxyServer = async () => {
    let activatedServer = getActivatedServer(this.state.proxy);
    const serverIp = await lookupIp(activatedServer.host);
    activatedServer = { ...activatedServer, host: serverIp };
    return activatedServer;
  };
}

const lookupGeoIp = async (ip: string) => {
  const db = await maxmind.open<CountryResponse>(
    path.join(getResourcesPath(), "geoip", "GeoLite2-Country.mmdb")
  );
  return db.get(ip);
};

export const lookupRegionCode = async (host: string) => {
  try {
    const ip = await lookupIp(host);
    const geoResult = await lookupGeoIp(ip);
    if (geoResult?.country) {
      return geoResult.country.iso_code;
    } else return undefined;
  } catch {
    return undefined;
  }
};
