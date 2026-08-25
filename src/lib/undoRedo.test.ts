import { beforeEach, describe, expect, it } from "vitest";
import { __resetUndoRedo, pushUndo, redoOnce, setUndoScope, undoOnce, undoRedoState } from "./undoRedo";

const action = (log: string[], name: string) => ({
  label: name,
  undo: () => void log.push(`undo:${name}`),
  redo: () => void log.push(`redo:${name}`),
});

beforeEach(() => {
  __resetUndoRedo();
  setUndoScope("workspace:test");
});

describe("one press, one action", () => {
  it("undoes and redoes exactly one step per call", async () => {
    const log: string[] = [];
    pushUndo(action(log, "a"));
    pushUndo(action(log, "b"));

    expect(await undoOnce()).toBe(true);
    expect(log).toEqual(["undo:b"]);
    expect(await undoOnce()).toBe(true);
    expect(log).toEqual(["undo:b", "undo:a"]);
    expect(await undoOnce()).toBe(false); // trail exhausted

    expect(await redoOnce()).toBe(true);
    expect(log).toEqual(["undo:b", "undo:a", "redo:a"]);
    expect(await redoOnce()).toBe(true);
    expect(log).toEqual(["undo:b", "undo:a", "redo:a", "redo:b"]);
    expect(await redoOnce()).toBe(false);
  });

  it("a new edit clears the redo trail", async () => {
    const log: string[] = [];
    pushUndo(action(log, "a"));
    await undoOnce();
    expect(undoRedoState().canRedo).toBe(true);
    pushUndo(action(log, "b"));
    expect(undoRedoState().canRedo).toBe(false);
  });
});

describe("workspace scoping", () => {
  it("keeps the trail while the scope key is unchanged", () => {
    const log: string[] = [];
    pushUndo(action(log, "a"));
    setUndoScope("workspace:test"); // closing an inner editor re-announces the same workspace
    expect(undoRedoState().canUndo).toBe(true);
  });

  it("drops the trail on a workspace change — table means oh well", () => {
    const log: string[] = [];
    pushUndo(action(log, "a"));
    setUndoScope("workspace:table");
    expect(undoRedoState().canUndo).toBe(false);
    expect(undoRedoState().canRedo).toBe(false);
  });
});

describe("failure handling", () => {
  it("drops an action whose inverse throws instead of wedging the trail", async () => {
    const log: string[] = [];
    pushUndo({ label: "bad", undo: () => Promise.reject(new Error("gone")), redo: () => {} });
    pushUndo(action(log, "good"));
    expect(await undoOnce()).toBe(true); // good
    expect(await undoOnce()).toBe(false); // bad fails, dropped
    expect(undoRedoState().canUndo).toBe(false);
  });

  it("exposes labels for the button tooltips", () => {
    const log: string[] = [];
    pushUndo({ label: 'edit "Cognition"', undo: () => void log.push("u"), redo: () => void log.push("r") });
    expect(undoRedoState().undoLabel).toBe('edit "Cognition"');
  });
});
