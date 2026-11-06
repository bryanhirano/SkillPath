import { RECEIVE_USER, UPDATE_USER } from "../actions/user";

export default function user(state = {}, action) {
	switch (action.type) {
		case RECEIVE_USER:
			return {
				...state,
				...action.user,
			};

		case UPDATE_USER:
			return {
				...state,
				color: action.userInfo.color,
				phone: action.userInfo.phone,
			};

		default:
			return state;
	}
}
