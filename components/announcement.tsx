"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Announcement } from "@/lib/announcement";

export function AnnouncementSurface({ announcement, scope = "app" }: { announcement: Announcement | null; scope?: string }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!announcement || announcement.mode !== "modal") return;
    const key = `announcement:${scope}:${announcement.id}:closed`;
    if (sessionStorage.getItem(key)) return;
    setOpen(true);
  }, [announcement, scope]);

  if (!announcement) return null;
  if (scope === "app" && !mounted) return null;

  const render = (node: ReactNode) => (scope === "app" ? createPortal(node, document.body) : node);

  if (announcement.mode === "marquee") {
    return render(
      <div className={`announcement-bar announcement-${scope}`} role="status">
        <div className="announcement-bar-label">{announcement.title}</div>
        <div className="announcement-marquee">
          <div className="announcement-marquee-track" dangerouslySetInnerHTML={{ __html: announcement.html }} />
        </div>
      </div>
    );
  }

  function close() {
    if (announcement) sessionStorage.setItem(`announcement:${scope}:${announcement.id}:closed`, "1");
    setOpen(false);
  }

  return open ? render(
    <div className="modal-backdrop" onClick={close}>
      <div className="modal announcement-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{announcement.title}</h2>
          <button className="modal-close" type="button" onClick={close} aria-label="关闭">×</button>
        </div>
        <div className="modal-body announcement-html" dangerouslySetInnerHTML={{ __html: announcement.html }} />
        <div className="modal-foot">
          <button className="btn primary" type="button" onClick={close}>知道了</button>
        </div>
      </div>
    </div>
  ) : null;
}
