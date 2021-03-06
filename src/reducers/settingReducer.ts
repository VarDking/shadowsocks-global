import { createSlice, PayloadAction } from "@reduxjs/toolkit";

const GOOGLE_DNS = "8.8.8.8";
const DNS_POD = "119.29.29.29";

export type DnsSettingState = {
  local: string;
  remote: string;
};

export type Route = { ip: string; isProxy: boolean };

export type RuleState = {
  current: string;
  dirPath: string;
  additionalRoutes: Route[];
};

export type GeneralState = {
  dnsOverUdp: boolean;
  updateSubscriptionsOnOpen: boolean;
  runAtSystemStartup: boolean;
  hideWhenWindowIsClosed: boolean;
  hideAfterConnection: boolean;
  autoConnect: boolean;
  autoConnectDelay: number; //Seconds
};

export type SettingState = {
  general: GeneralState;
  dns: DnsSettingState;
  rule: RuleState;
};

//Note: The state will be initialed in configureStore by preloadedState.
export const initialSettingState: SettingState = {
  general: {
    dnsOverUdp: false,
    updateSubscriptionsOnOpen: false,
    runAtSystemStartup: false,
    hideWhenWindowIsClosed: true,
    hideAfterConnection: false,
    autoConnect: false,
    autoConnectDelay: 5,
  },
  dns: {
    local: DNS_POD,
    remote: GOOGLE_DNS,
  },
  rule: {
    current: "global",
    dirPath: "",
    additionalRoutes: [],
  },
};

export const setting = createSlice({
  name: "setting",
  initialState: initialSettingState,
  reducers: {
    setGeneral: (state, action: PayloadAction<GeneralState>) => {
      state.general = action.payload;
    },
    setCustomizedDns: (state, action: PayloadAction<DnsSettingState>) => {
      state.dns = action.payload;
    },
    setCurrentRule: (state, action: PayloadAction<string>) => {
      state.rule.current = action.payload;
    },
    setCustomizedRulesDirPath: (state, action: PayloadAction<string>) => {
      state.rule.dirPath = action.payload;
    },
    addAdditionalRoute: (state, action: PayloadAction<Route>) => {
      state.rule.additionalRoutes.push(action.payload);
    },
    deleteAdditionalRoute: (state, action: PayloadAction<string>) => {
      state.rule.additionalRoutes = state.rule.additionalRoutes.filter(
        (route) => route.ip !== action.payload
      );
    },
  },
});
