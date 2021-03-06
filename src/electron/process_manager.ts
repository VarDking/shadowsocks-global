// Copyright 2018 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { execSync } from "child_process";
import { powerMonitor } from "electron";
import { ChildProcess, spawn } from "child_process";
import { getResourcesPath, pathToEmbeddedBinary, RemoteServer } from "./utils";
import { logger } from "./log";
import * as path from "path";
import { sendMessageToRender } from "./ipc";
import detectPort from "detect-port";
import { manager } from "./manager";
import { DnsSettingState } from "../reducers/settingReducer";

const TUN2SOCKS_TAP_DEVICE_NAME = "shadowsocksGlobal-tap0";

//Must be different with Outline
const TUN2SOCKS_TAP_DEVICE_IP = "10.0.85.3";
const TUN2SOCKS_VIRTUAL_ROUTER_IP = "10.0.85.1";
const TUN2SOCKS_VIRTUAL_ROUTER_NETMASK = "255.255.255.0";

// Raises an error if:
//  - the TAP device does not exist
//  - the TAP device does not have the expected IP/subnet
//
// Note that this will *also* throw if netsh is not on the PATH. If that's the case then the
// installer should have failed, too.
//
// Only works on Windows!
//
// TODO: Probably should be moved to a new file, e.g. configuation.ts.
function testTapDevice() {
  // Sample output:
  // =============
  // $ netsh interface ipv4 dump
  // # ----------------------------------
  // # IPv4 Configuration
  // # ----------------------------------
  // pushd interface ipv4
  //
  // reset
  // set global icmpredirects=disabled
  // set interface interface="Ethernet" forwarding=enabled advertise=enabled nud=enabled
  // ignoredefaultroutes=disabled set interface interface="outline-tap0" forwarding=enabled
  // advertise=enabled nud=enabled ignoredefaultroutes=disabled add address name="outline-tap0"
  // address=10.0.85.2 mask=255.255.255.0
  //
  // popd
  // # End of IPv4 configuration
  const lines = execSync(`netsh interface ipv4 dump`).toString().split("\n");

  // Find lines containing the TAP device name.
  const tapLines = lines.filter(
    (s) => s.indexOf(TUN2SOCKS_TAP_DEVICE_NAME) !== -1
  );
  if (tapLines.length < 1) {
    throw new Error("TAP device not found");
  }
}

// Establishes a full-system VPN with the help of Outline's routing daemon and child processes
// ss-local and tun2socks. Follows the Mediator pattern in that none of the three "helpers" know
// anything about the others.
//
// In addition to the basic lifecycle of the three helper processes, this handles a few special
// situations:
//  - repeat the UDP test when the network changes and restart tun2socks if the result has changed
//  - silently restart tun2socks when the system is about to suspend (Windows only)
export class ConnectionManager {
  private exits: Promise<void>[] = [];
  private readonly tun2socks: Tun2socks;

  // Extracted out to an instance variable because in certain situations, notably a change in UDP
  // support, we need to stop and restart tun2socks *without notifying the client* and this allows
  // us swap the listener in and out.
  private tun2socksExitListener?: () => void | undefined;

  private onceStoppedListener = () => {};

  // See #resumeListener.
  private terminated = false;

  private isDisconnecting = false;

  private readonly onAllHelpersStopped: Promise<void>;

  private reconnectingListener?: () => void;

  private reconnectedListener?: () => void;

  constructor(
    private remoteServer: RemoteServer,
    private isDnsOverUdp: boolean,
    private dns: DnsSettingState,
    private rule: string
  ) {
    this.tun2socks = new Tun2socks(
      this.dns,
      this.remoteServer.host,
      this.rule,
      this.remoteServer
    );

    // This trio of Promises, each tied to a helper process' exit, is key to the instance's
    // lifecycle:
    //  - once any helper fails or exits, stop them all
    //  - once *all* helpers have stopped, we're done
    this.exits = [
      new Promise<void>((fulfill) => {
        this.tun2socksExitListener = fulfill;
        this.tun2socks.onExit = this.tun2socksExitListener;
      }),
      // new Promise<void>((fulfill) => {
      //   this.ssLocalExitListener = fulfill;
      //   if (this.ssLocal) this.ssLocal.onExit = this.ssLocalExitListener;
      // }),
    ];
    Promise.race(this.exits).then(() => {
      logger.info("a helper has exited, disconnecting");
      this.isDisconnecting = true;
      this.stop();
    });
    this.onAllHelpersStopped = Promise.all(this.exits)
      .then(() => {
        logger.info("all helpers have exited");
        this.terminated = true;
      })
      .then(() => {
        this.onceStoppedListener();
      });

    // Handle network changes and, on Windows, suspend events.
    powerMonitor.on("suspend", this.suspendListener.bind(this));
    powerMonitor.on("resume", this.resumeListener.bind(this));
  }
  private suspendListener() {
    // Swap out the current listener, restart once the system resumes.
    this.tun2socks.onExit = () => {
      logger.info("stopped tun2socks in preparation for suspend");
    };
    this.tun2socks.stop();
  }

  private async resumeListener() {
    if (this.terminated) {
      // NOTE: Cannot remove resume listeners - Electron bug?
      logger.error(
        "resume event invoked but this connection is terminated - doing nothing"
      );
      return;
    }
    logger.info("restarting tun2socks after resume");
    this.tun2socks.onExit = this.tun2socksExitListener;
    await this.tun2socks.start(this.isDnsOverUdp);
  }

  // Fulfills once all three helpers have started successfully.
  async start() {
    sendMessageToRender("Checking tap device...");
    // testTapDevice();

    sendMessageToRender("Staring tun2socks...");
    await this.tun2socks.start(this.isDnsOverUdp);

    //TODO: Implement a listener that terminates the start process once this.disconnecting become true.
    if (this.isDisconnecting)
      throw new Error(
        "Fail to start one or some of smartDns,ss-local,tun2socks"
      );

    if (this.isDisconnecting)
      throw new Error(
        "Fail to start one or some of smartDns,ss-local,tun2socks"
      );

    sendMessageToRender("Configuring routes...");
  }

  // Use #onceStopped to be notified when the connection terminates.
  stop() {
    powerMonitor.removeAllListeners("suspend");
    powerMonitor.removeAllListeners("resume");

    try {
    } catch (e) {
      // This can happen for several reasons, e.g. the daemon may have stopped while we were
      // connected.
      logger.error(`could not stop routing: ${e.message}`);
    }

    this.tun2socks.stop();
  }

  // Fulfills once all three helper processes have stopped.
  //
  // When this happens, *as many changes made to the system in order to establish the full-system
  // VPN as possible* will have been reverted.
  public set onceStopped(newListen: () => void | undefined) {
    this.onceStoppedListener = newListen;
  }

  // Sets an optional callback for when the routing daemon is attempting to re-connect.
  public set onReconnecting(newListener: () => void | undefined) {
    this.reconnectingListener = newListener;
  }

  // Sets an optional callback for when the routing daemon successfully reconnects.
  public set onReconnected(newListener: () => void | undefined) {
    this.reconnectedListener = newListener;
  }
}
// Simple "one shot" child process launcher.
//
// NOTE: Because there is no way in Node.js to tell whether a process launched successfully,
//       #startInternal always succeeds; use #onExit to be notified when the process has exited
//       (which may be immediately after calling #startInternal if, e.g. the binary cannot be
//       found).
const MAX_RESTART_INTERVAL_MS = 2000;
class ChildProcessHelper {
  //Whether the process is killed by "this.stop"
  private isExiting = false;

  private lastExitTime: number | undefined;

  private process?: ChildProcess;

  private exitListener?: () => void;

  constructor(private path: string) {}

  protected launch(args: string[]) {
    this.process = spawn(this.path, args);
    if (this.process.stdout) {
      this.process.stdout.on("data", (data) => {
        logger.info(`stdout: ${data}`);
      });
    }
    if (this.process.stderr)
      this.process.stderr.on("data", (data) => {
        logger.error(`stderr: ${data}`);
      });

    const onError = () => {
      if (this.process) {
        this.process.removeAllListeners();
      }

      if (this.exitListener) {
        this.exitListener();
      }
    };
    const onExit = () => {
      if (this.process) {
        this.process.removeAllListeners();
      }
      const restart = () => {
        logger.info(`Restart ${path.basename(this.path)}`);
        this.launch(args);
      };
      //Restarted the process if it's not killed by "this.stop"
      if (!this.isExiting) {
        if (!this.lastExitTime) {
          this.lastExitTime = Date.now();
          return restart();
        }
        const currentExitTime = Date.now();
        const internal = currentExitTime - this.lastExitTime;
        if (internal > MAX_RESTART_INTERVAL_MS) {
          this.lastExitTime = currentExitTime;
          return restart();
        }
      }
      if (this.exitListener) {
        this.exitListener();
      }
    };

    // We have to listen for both events: error means the process could not be launched and in that
    // case exit will not be invoked.
    this.process.on("error", onError.bind(this));
    this.process.on("exit", onExit.bind(this));
  }

  // Use #onExit to be notified when the process exits.
  stop() {
    if (!this.process) {
      // Never started.
      if (this.exitListener) {
        this.exitListener();
      }
      return;
    }

    this.isExiting = true;
    this.process.kill();
  }

  set onExit(newListener: (() => void) | undefined) {
    this.exitListener = newListener;
  }
}

class Tun2socks extends ChildProcessHelper {
  constructor(
    private dns: DnsSettingState,
    private targetServerIp: string,
    private acl: string,
    private ssServer: Omit<RemoteServer, "type">
  ) {
    super(pathToEmbeddedBinary("go-tun2socks", "tun2socks"));
  }

  async start(isDnsOverUdp: boolean) {
    const args: string[] = [];
    args.push("-rule", this.acl);
    args.push("-tunName", TUN2SOCKS_TAP_DEVICE_NAME);
    args.push("-tunAddr", TUN2SOCKS_TAP_DEVICE_IP);
    args.push("-tunMask", TUN2SOCKS_VIRTUAL_ROUTER_NETMASK);
    args.push("-tunGw", TUN2SOCKS_VIRTUAL_ROUTER_IP);

    args.push("-proxyServer", `${this.ssServer.host}:${this.ssServer.port}`);

    args.push("-proxyPassword", this.ssServer.password);
    args.push("-proxyCipher", this.ssServer.method);
    if (this.ssServer.plugin) {
      args.push(
        "-proxyPlugin",
        this.ssServer.plugin.includes("obfs") ? "obfs" : this.ssServer.plugin
      );
    }

    if (this.ssServer.plugin_opts)
      args.push("-proxyPluginOpts", this.ssServer.plugin_opts);
    args.push("-proxyType", "shadowsocks");

    args.push(
      "-geoIpDb",
      path.join(getResourcesPath(), "geoip", "GeoLite2-Country.mmdb")
    );

    args.push("-loglevel", "error");

    if (!isDnsOverUdp) args.push("-dnsFallback");
    args.push("-remoteDNSAddr", this.dns.remote);
    args.push("-localDNSAddr", this.dns.local);

    const port = await detectPort(manager.listeningPort);
    if (port !== manager.listeningPort) manager.newListeningPort = port;
    args.push("-managerAddr", `127.0.0.1:${manager.listeningPort}`);
    this.launch(args);
  }
}
