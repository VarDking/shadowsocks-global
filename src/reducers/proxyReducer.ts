import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { v4 as uuid } from "uuid";

export type Shadowsocks = {
  id: string;
  host: string;
  port: number;

  method: string;
  password: string;
  name?: string;

  plugin?: string;
  plugin_opts?: string;

  regionCode?: string;
};

export type Subscription = {
  id: string;
  name: string;
  url: string;
  shadowsockses: Shadowsocks[];
};

export type Socks5 = {
  id: string;
  regionCode?: string;
  host: string;
  port: number;
};

export type ProxyState = {
  isStarted: boolean;
  //Starting or Stopping
  isProcessing: boolean;
  activeId: string;
  shadowsockses: Shadowsocks[];
  subscriptions: Subscription[];
  socks5s: Socks5[];
};

export const initialProxyState: ProxyState = {
  isStarted: false,
  isProcessing: false,
  activeId: "",
  shadowsockses: [],
  subscriptions: [],
  socks5s: []
};

export const proxy = createSlice({
  name: "proxy",
  initialState: initialProxyState,
  reducers: {
    startVpn: state => {
      state.isStarted = true;
    },
    stopVpn: state => {
      state.isStarted = false;
    },
    setIsProcessing: (state, action: PayloadAction<boolean>) => {
      state.isProcessing = action.payload;
    },
    setActiveId: (state, action: PayloadAction<string>) => {
      state.activeId = action.payload;
    },
    add: {
      reducer: (state, action: any) => {
        const { type, config } = action.payload;
        switch (type) {
          case "shadowsocks":
            state.shadowsockses.push(config);
            break;
          case "subscription":
            state.subscriptions.push(config);
            break;
          //Socks5
          default:
            state.socks5s.push(config);
        }
      },
      prepare: (
        proxy:
          | { type: "shadowsocks"; config: Omit<Shadowsocks, "id"> }
          | { type: "subscription"; config: Omit<Subscription, "id"> }
          | { type: "socks5"; config: Omit<Socks5, "id"> }
      ) => ({
        payload: { ...proxy, config: { id: uuid(), ...proxy.config } }
      })
    },
    update: (
      state,
      action: PayloadAction<
        | { type: "shadowsocks"; config: Shadowsocks }
        | { type: "subscription"; config: Subscription }
        | { type: "socks5"; config: Socks5 }
      >
    ) => {
      const { type, config } = action.payload;
      switch (type) {
        case "shadowsocks":
          {
            const shadowsocksIndex = state.shadowsockses.findIndex(
              proxy => proxy.id === config.id
            );
            if (shadowsocksIndex === -1) {
              state.subscriptions.some((subscription, subscriptionIndex) =>
                subscription.shadowsockses.some(
                  (shadowsocks, subShadowsocksIndex) => {
                    if (shadowsocks.id === config.id) {
                      state.subscriptions[subscriptionIndex].shadowsockses[
                        subShadowsocksIndex
                      ] = config as Shadowsocks;
                      return true;
                    }
                    return false;
                  }
                )
              );
            } else
              state.shadowsockses[shadowsocksIndex] = config as Shadowsocks;
          }
          break;
        case "subscription":
          {
            const index = state.subscriptions.findIndex(
              subscription => subscription.id === config.id
            );
            state.subscriptions[index] = config as Subscription;
          }
          break;
        //Socks5
        default: {
          const index = state.socks5s.findIndex(
            socks5 => socks5.id === config.id
          );
          state.socks5s[index] = config as Socks5;
        }
      }
    },
    delete: (
      state,
      action: PayloadAction<{
        type: "shadowsocks" | "subscription" | "socks5";
        id: string;
      }>
    ) => {
      const { type, id } = action.payload;
      switch (type) {
        case "shadowsocks":
          {
            const shadowsocksIndex = state.shadowsockses.findIndex(
              shadowsocks => shadowsocks.id === id
            );
            if (shadowsocksIndex === -1) {
              state.subscriptions.some((subscription, subscriptionIndex) =>
                subscription.shadowsockses.some(
                  (shadowsocks, subShadowsocksIndex) => {
                    if (shadowsocks.id === id) {
                      state.subscriptions[
                        subscriptionIndex
                      ].shadowsockses.splice(subShadowsocksIndex, 1);
                      return true;
                    }
                    return false;
                  }
                )
              );
            } else state.shadowsockses.splice(shadowsocksIndex, 1);
          }
          break;
        case "subscription":
          state.subscriptions = state.subscriptions.filter(
            subscription => subscription.id !== id
          );
          break;
        //Socks5
        default: {
          state.socks5s = state.socks5s.filter(socks5 => socks5.id !== id);
        }
      }
    }
  }
});
