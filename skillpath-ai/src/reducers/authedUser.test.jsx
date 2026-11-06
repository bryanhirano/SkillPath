import { describe, expect, it } from "vitest";
import { logOutUser, setAuthedUser } from "../actions/authedUsers.jsx";
import authedUser from "./authedUser.jsx";

describe("authedUser reducer", () => {
	it("starts with no authenticated user", () => {
		expect(authedUser(undefined, { type: "unknown" })).toBeNull();
	});

	it("stores the authenticated user's ID", () => {
		expect(authedUser(null, setAuthedUser("user-123"))).toBe("user-123");
	});

	it("clears the authenticated user on logout", () => {
		expect(authedUser("user-123", logOutUser("user-123"))).toBeNull();
	});

	it("preserves the current state for an unrelated action", () => {
		expect(authedUser("user-123", { type: "unknown" })).toBe("user-123");
	});
});
