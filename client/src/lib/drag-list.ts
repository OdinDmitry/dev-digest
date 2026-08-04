/**
 * Hand-rolled HTML5 drag-to-reorder for a list of ids.
 *
 * Deliberately dependency-free: the app pulls in no DnD library, and reordering
 * a short list of strings does not justify one. Lives in `lib/` because it wraps
 * a browser API and carries no domain vocabulary.
 *
 * Browser gotchas encoded here, all of which silently break drag if omitted:
 *  - `onDragOver` MUST call `preventDefault()`, or the drop event never fires.
 *  - `dataTransfer.setData` must be called in `onDragStart`, or Firefox refuses
 *    to start the drag at all.
 *  - The dragged element is identified by our own state, not by `dataTransfer`
 *    payloads, which are unreadable during `dragover` in most browsers.
 */
"use client";

import React from "react";

/** Move `from` → `to`, returning a new array. Out-of-range indices are a no-op. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...list];
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

export interface DragListRowProps {
  draggable: true;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

export interface DragList {
  /** Id currently being dragged, or null. */
  dragging: string | null;
  /** Id currently hovered as a drop target, or null. */
  over: string | null;
  /** Spread onto a row element to make it draggable and droppable. */
  rowProps: (id: string) => DragListRowProps;
}

/**
 * `onReorder` fires once, on drop, with the full reordered id list — callers
 * persist that directly. No callback fires when the drop lands where it started.
 */
export function useDragList(ids: readonly string[], onReorder: (next: string[]) => void): DragList {
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);

  const rowProps = React.useCallback(
    (id: string): DragListRowProps => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setDragging(id);
        e.dataTransfer.effectAllowed = "move";
        // Firefox will not begin a drag unless some data is set.
        e.dataTransfer.setData("text/plain", id);
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault(); // without this, onDrop never fires
        e.dataTransfer.dropEffect = "move";
        if (id !== over) setOver(id);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const sourceId = dragging ?? e.dataTransfer.getData("text/plain");
        setDragging(null);
        setOver(null);
        if (!sourceId || sourceId === id) return;
        const from = ids.indexOf(sourceId);
        const to = ids.indexOf(id);
        if (from === -1 || to === -1) return;
        onReorder(moveItem(ids, from, to));
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
    }),
    [ids, dragging, over, onReorder],
  );

  return { dragging, over, rowProps };
}
