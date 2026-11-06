import { describe, expect, it } from "vitest";
import { receiveUser, updateUser } from "../actions/user.jsx";
import user from "./user.jsx";

describe("user reducer", () => {
	it("starts with an empty profile", () => {
		expect(user(undefined, { type: "unknown" })).toEqual({});
	});

	it("merges a received profile with existing fields", () => {
		const state = { color: "blue" };
		const profile = { name: "Ada Lovelace", email: "ada@example.com" };

		expect(user(state, receiveUser(profile))).toEqual({
			color: "blue",
			...profile,
		});
	});

	it("updates profile fields without nesting them under another state key", () => {
		const state = { name: "Ada Lovelace", color: "blue", phone: "old" };

		expect(
			user(state, updateUser({ color: "green", phone: "555-0100" })),
		).toEqual({
			name: "Ada Lovelace",
			color: "green",
			phone: "555-0100",
		});
	});

	it("preserves the current state for an unrelated action", () => {
		const state = { name: "Ada Lovelace" };

		expect(user(state, { type: "unknown" })).toBe(state);
	});
});
