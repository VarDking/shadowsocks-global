import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import styles from "./header.module.css";
import {
  Button,
  Dialog,
  Dropdown,
  Icon,
  ICON_NAME,
  ICON_SIZE,
  Selector,
} from "../Core";
import { notifier } from "../Core/Notification";
import { AppState } from "../../reducers/rootReducer";
import { useSelector, useDispatch } from "react-redux";
import fs from "fs";
import promiseIpc from "electron-promise-ipc";
import path from "path";
import { setting } from "../../reducers/settingReducer";
import { proxy, Shadowsocks, Subscription } from "../../reducers/proxyReducer";
import { clipboard, ipcRenderer } from "electron";
import { updateSubscription } from "../../utils/helper";
import { LoadingDialog } from "../Dialogs/LoadingDialog";
import { decodeSsUrl } from "../../utils/url";
import { EditShadowsocksDialog } from "../Dialogs/EditShadowsocksDialog";
import { EditSocks5sDialog } from "../Dialogs/EditSocks5sDialog";
import { EditSubscriptionDialog } from "../Dialogs/EditSubscriptionDialog";
import Dashboard from "../Dashboard/Dashboard";
import Setting from "../Setting/Setting";
import About from "../About/About";
import Store from "electron-store";
import {
  BUILD_IN_RULE_GLOBAL,
  BUILD_IN_RULE_BYPASS_MAINLAND_CHINA,
} from "../../share";

const PROXY_TYPES = ["Shadowsocks", "Socks5", "Subscription"];
const MANGE_TYPES = ["Statistics", "Setting", "About"];
const Header = () => {
  const subscriptions = useSelector<AppState, Subscription[]>(
    (state) => state.proxy.subscriptions
  );
  const isUpdateSubscriptionsOnOpen = useSelector<AppState, boolean>(
    (state) => state.setting.general.isUpdateSubscriptionsOnOpen
  );
  const [isUpdatingSubscriptions, setIsUpdatingSubscriptions] = useState(false);
  const [autoConnectTimer, setConnectTimer] = useState<NodeJS.Timeout>();
  const isAutoConnect = useSelector<AppState, boolean>(
    (state) => state.setting.general.isAutoConnect
  );
  const autoConnectDelay = useSelector<AppState, number>(
    (state) => state.setting.general.autoConnectDelay
  );
  const dispatch = useDispatch();

  //Init app
  useLayoutEffect(() => {
    const autoConnect = () => {
      setConnectTimer(setTimeout(start, autoConnectDelay * 1000));
    };
    if (isUpdateSubscriptionsOnOpen) {
      const updateSubscriptions = async () => {
        await Promise.all(
          subscriptions.map((subscription) =>
            updateSubscription(subscription.url).then((shadowsockses) => {
              dispatch(
                proxy.actions.update({
                  type: "subscription",
                  id: subscription.id,
                  config: { shadowsockses },
                })
              );
            })
          )
        );
      };

      setIsUpdatingSubscriptions(true);
      updateSubscriptions()
        .then(() => {
          notifier.success("Update subscriptions successfully");
        })
        .catch(() => {
          notifier.error("Fail to update subscriptions");
        })
        .finally(() => {
          setIsUpdatingSubscriptions(false);
          if (isAutoConnect) autoConnect();
        });
    } else if (isAutoConnect) {
      autoConnect();
    }
    //TODO: use customized channel for "Disconnected" because there are others message.
    ipcRenderer.on("proxy-disconnected", () => {
      dispatch(proxy.actions.setIsProcessing(false));
      dispatch(proxy.actions.setIsConnected(false));
    });

    ipcRenderer.send("setRunAtSystemStartup");

    //If the app crashes unexpectedly, the "Connect" Button can be loading state after restarting app.
    //To avoid that, the state mush be reset.
    dispatch(proxy.actions.setIsProcessing(false));
    dispatch(proxy.actions.setIsConnected(false));
    return () => {
      ipcRenderer.removeAllListeners("proxy-disconnected");
    };
    //Only be fired once to init app.
  }, []); // eslint-disable-line
  const customizedRulesDirPath = useSelector<AppState, string>(
    (state) => state.setting.rule.dirPath
  );
  const isConnected = useSelector<AppState, boolean>(
    (state) => state.proxy.isConnected
  );
  const isProcessing = useSelector<AppState, boolean>(
    (state) => state.proxy.isProcessing
  );
  const activeId = useSelector<AppState, string>(
    (state) => state.proxy.activeId
  );
  const currentRule = useSelector<AppState, string>(
    (state) => state.setting.rule.current
  );
  const isHideAfterConnection = useSelector<AppState, boolean>(
    (state) => state.setting.general.isHideAfterConnection
  );
  const [rulePaths, setRulePaths] = useState<string[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [currentDialogType, setCurrentDialogType] = useState("");
  const addProxyDropdownItems = useMemo(
    () => [
      ...PROXY_TYPES.map((type) => ({
        content: type,
        handleOnClick: () => {
          setCurrentDialogType(type);
        },
      })),
      {
        content: "Import URL from Clipboard",
        handleOnClick: async () => {
          try {
            const url = clipboard.readText();
            let shadowsockses = decodeSsUrl(url);
            if (shadowsockses.length === 0) return;
            shadowsockses = shadowsockses.map((shadowsocks) => ({
              ...shadowsocks,
              regionCode: "Auto",
            }));
            (shadowsockses as Shadowsocks[]).forEach((shadowsocks) =>
              dispatch(
                proxy.actions.add({ type: "shadowsocks", config: shadowsocks })
              )
            );
          } catch (e) {}
        },
      },
    ],
    [dispatch]
  );
  const manageDropdownItems = useMemo(
    () => [
      ...MANGE_TYPES.map((type) => ({
        content: type,
        handleOnClick: () => {
          setCurrentDialogType(type);
        },
      })),
      {
        content: "Open the log file",
        handleOnClick: () => {
          ipcRenderer.send("openLogFile");
        },
      },
      {
        content: "Open the configuration file",
        handleOnClick: () => {
          const store = new Store();
          store.openInEditor();
        },
      },
    ],
    []
  );
  const closeDialog = useCallback(() => {
    setCurrentDialogType("");
  }, []);
  const changeCurrentRule = useCallback(
    (rule: string) => dispatch(setting.actions.setCurrentRule(rule)),
    [dispatch]
  );

  const start = useCallback(async () => {
    try {
      if (autoConnectTimer) clearTimeout(autoConnectTimer);
      if (!activeId) {
        notifier.error("No server has been selected!");
        return;
      }
      dispatch(proxy.actions.setIsProcessing(true));
      //@ts-ignore
      await promiseIpc.send("start");
      dispatch(proxy.actions.setIsConnected(true));
      if (isHideAfterConnection) ipcRenderer.send("hideWindow");
    } catch (e) {
      if (e.message && typeof e.message === "string") notifier.error(e.message);
      else notifier.error("Unknown error");
    } finally {
      dispatch(proxy.actions.setIsProcessing(false));
    }
  }, [activeId, autoConnectTimer, dispatch, isHideAfterConnection]);
  useEffect(() => {
    const loadRulePath = async () => {
      setIsLoadingRules(true);
      let rulePaths: string[] = [];
      if (customizedRulesDirPath)
        try {
          const customizedRules = await fs.promises.readdir(
            customizedRulesDirPath
          );
          customizedRules.forEach((rule) => {
            if (path.extname(rule) === ".rules")
              rulePaths.push(path.join(customizedRulesDirPath, rule));
          });
        } catch {
          notifier.error("Fail to load customized rules");
        }
      setRulePaths(rulePaths);
    };
    loadRulePath().then(() => {
      setIsLoadingRules(false);
    });
  }, [customizedRulesDirPath]);

  const stop = useCallback(async () => {
    dispatch(proxy.actions.setIsProcessing(true));
    try {
      // @ts-ignore
      await promiseIpc.send("stop");
      dispatch(proxy.actions.setIsConnected(false));
    } catch (e) {
      console.log(e);
    } finally {
      dispatch(proxy.actions.setIsProcessing(false));
    }
  }, [dispatch]);
  const rulesOptions = useMemo(
    () => [
      { value: BUILD_IN_RULE_GLOBAL },
      { value: BUILD_IN_RULE_BYPASS_MAINLAND_CHINA },
      ...rulePaths.map((rulePath) => ({
        value: path.basename(rulePath, ".rules"),
      })),
    ],
    [rulePaths]
  );

  return (
    <>
      {currentDialogType === PROXY_TYPES[0] && (
        <EditShadowsocksDialog close={closeDialog} />
      )}
      {currentDialogType === PROXY_TYPES[1] && (
        <EditSocks5sDialog close={closeDialog} />
      )}
      {currentDialogType === PROXY_TYPES[2] && (
        <EditSubscriptionDialog close={closeDialog} />
      )}
      {currentDialogType === MANGE_TYPES[0] && (
        <Dialog close={closeDialog}>
          <Dashboard />
        </Dialog>
      )}
      {currentDialogType === MANGE_TYPES[1] && (
        <Dialog close={closeDialog}>
          <Setting />
        </Dialog>
      )}
      {currentDialogType === MANGE_TYPES[2] && (
        <Dialog close={closeDialog}>
          <About />
        </Dialog>
      )}
      {isUpdatingSubscriptions && (
        <LoadingDialog content={"Updating subscriptions..."} />
      )}
      <div className={styles.container}>
        {isConnected ? (
          <Button
            isDanger={true}
            className={styles.button}
            onClick={stop}
            isLoading={isProcessing}
            disabled={isProcessing}
          >
            {isProcessing ? "Disconnecting" : "Disconnect"}
          </Button>
        ) : (
          <Button
            isPrimary={true}
            className={styles.button}
            onClick={start}
            isLoading={isProcessing}
            disabled={isProcessing}
          >
            {isProcessing ? "Connecting" : "Connect"}
          </Button>
        )}

        <Selector
          options={rulesOptions}
          label={"Rule"}
          value={currentRule}
          onChange={changeCurrentRule}
          className={styles.selector}
          disabled={isLoadingRules || isConnected || isProcessing}
          isVirtualizedList={rulesOptions.length > 4}
        />

        <div className={styles.iconButtons}>
          <Dropdown items={addProxyDropdownItems}>
            <Button className={styles.item}>
              <Icon iconName={ICON_NAME.PLUS} size={ICON_SIZE.SIZE24} />
            </Button>
          </Dropdown>
          <Dropdown items={manageDropdownItems}>
            <Button className={styles.item}>
              <Icon iconName={ICON_NAME.SETTING} size={ICON_SIZE.SIZE24} />
            </Button>
          </Dropdown>
        </div>
      </div>
    </>
  );
};

export default Header;
