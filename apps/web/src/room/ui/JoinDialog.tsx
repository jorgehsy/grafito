import { useState } from "react";
import { useT } from "../../i18n";
import { Logo } from "../../ui/icons";
import { cleanName, NAME_MAX } from "../identity";

interface Props {
  roomId: string;
  onJoin(name: string): void;
}

/** Shown the first time someone opens a room link in this browser: one field, Enter to join. */
export function JoinDialog({ roomId, onJoin }: Props) {
  const t = useT();
  const [name, setName] = useState("");
  const ok = !!cleanName(name);
  return (
    <div className="room-join" data-testid="room-join">
      <form className="card" role="dialog" aria-modal="true" aria-labelledby="room-join-title" onSubmit={(e) => { e.preventDefault(); if (ok) onJoin(name); }}>
        <div className="mark"><Logo /></div>
        <h2 id="room-join-title">{t("room.join.title")}</h2>
        <p>{t("room.join.hint")}</p>
        <input autoFocus data-testid="room-join-name" aria-label={t("room.join.placeholder")} placeholder={t("room.join.placeholder")} maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="pbtn primary" type="submit" disabled={!ok}>{t("room.join.go")}</button>
        <small>{t("room.badge", { id: roomId })}</small>
      </form>
    </div>
  );
}
