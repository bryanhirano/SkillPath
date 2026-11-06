import { LOG_OUT_USER, SET_AUTHED_USER } from "../actions/authedUsers";

export default function authedUser(state = null, action) {
	switch (action.type) {
		case SET_AUTHED_USER:
			return action.id;

		case LOG_OUT_USER:
			console.log("triggered");
			return null;

		default:
			return state;
	}
}
