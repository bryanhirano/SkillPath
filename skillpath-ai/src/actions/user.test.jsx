import { describe, expect, it } from "vitest";
import {
	RECEIVE_USER,
	REGISTER_USER,
	receiveUser,
	registerUser,
	UPDATE_USER,
	updateUser,
} from "./user.jsx";

describe("user action creators", () => {
	it("creates a receive-user action", () => {
		const profile = { name: "Ada Lovelace", email: "ada@example.com" };

		expect(receiveUser(profile)).toEqual({
			type: RECEIVE_USER,
			user: profile,
		});
	});

	it("creates a register-user action", () => {
		const userInfo = { firstName: "Ada", lastName: "Lovelace" };

		expect(registerUser(userInfo)).toEqual({
			type: REGISTER_USER,
			userInfo,
		});
	});

	it("creates an update-user action", () => {
		const userInfo = { color: "blue", phone: "555-0100" };

		expect(updateUser(userInfo)).toEqual({
			type: UPDATE_USER,
			userInfo,
		});
	});
});
