import React, { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppState } from "../../reducers/rootReducer";
import { proxy, Shadowsocks } from "../../reducers/proxyReducer";
import styles from "./proxies.module.css";
import { ShadowsocksCard } from "../Cards/ShadowsocksCard";
import { Dropdown, Icon, ICON_NAME } from "../Core";
import { PingServer, usePing } from "../../hooks";
import { useTranslation } from "react-i18next";

type ShadowsocksesProps = {
  shadowsockses: Shadowsocks[];
};

export const Shadowsockses = React.memo((props: ShadowsocksesProps) => {
  const { shadowsockses } = props;
  const dispatch = useDispatch();
  const disabled = useSelector<AppState, boolean>(
    (state) => state.proxy.isProcessing || state.proxy.isConnected
  );
  const { t } = useTranslation();
  const pingServers = useMemo(
    () =>
      shadowsockses.map((shadowsocks) => ({
        type: "shadowsocks",
        id: shadowsocks.id,
        host: shadowsocks.host,
        port: shadowsocks.port,
      })),
    [shadowsockses]
  );

  const { isPinging, ping } = usePing(pingServers as PingServer[]);
  const dropdownItems = useMemo(
    () => [
      {
        iconName: ICON_NAME.INSTRUMENT,
        content: t("proxy.shadowsockses.ping"),
        handleOnClick: ping,
        disabled: isPinging || disabled,
      },
      {
        iconName: ICON_NAME.SORT,
        content: t("proxy.shadowsockses.sort"),
        disabled: isPinging || disabled,
        handleOnClick: () => {
          dispatch(
            proxy.actions.sortByPingTime({
              type: "shadowsockses",
            })
          );
        },
      },
      {
        iconName: ICON_NAME.DELETE,
        content: t("proxy.shadowsockses.delete"),
        isDanger: true,
        handleOnClick: () => {
          dispatch(
            proxy.actions.deleteAll({
              type: "shadowsocks",
            })
          );
        },
      },
    ],
    [disabled, dispatch, isPinging, ping, t]
  );
  return (
    <>
      {shadowsockses.length !== 0 && (
        <div className={styles.title}>
          Shadowsockses
          <Dropdown items={dropdownItems} disabled={disabled}>
            <Icon iconName={ICON_NAME.OMIT} className={styles.dropdownToggle} />
          </Dropdown>
        </div>
      )}
      <div className={styles.shadowsockses}>
        {shadowsockses.map((shadowsocks) => (
          <ShadowsocksCard shadowsocks={shadowsocks} key={shadowsocks.id} />
        ))}
      </div>
    </>
  );
});
