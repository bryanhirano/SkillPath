import { describe, expect, it } from "vitest";
import { setLoaded } from "../actions/loaded.jsx";
import loaded from "./loaded.jsx";

describe("loaded reducer", () => {
	it("starts in the unknown loading state", () => {
		expect(loaded(undefined, { type: "unknown" })).toBeNull();
	});

	it("stores a loaded value", () => {
		expect(loaded(null, setLoaded(true))).toBe(true);
		expect(loaded(false, setLoaded(false))).toBe(false);
	});

	it("preserves the current state for an unrelated action", () => {
		expect(loaded(true, { type: "unknown" })).toBe(true);
	});
});
