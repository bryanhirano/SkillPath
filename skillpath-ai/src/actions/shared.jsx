import { getInfo } from "../backend/firebase.jsx";
import { getInitialData } from "../backend/helpers.jsx";
import { setLoaded } from "./loaded.jsx";
import { receiveUser } from "./user.jsx";

// Runs after every login. Loads the user's profile and the app
// data, then always ends the loading screen, even if a read fails.

export function handleInitialData(uid) {
	return (dispatch, getState) => {
		// Ignore results that arrive after this user has logged out
		// or someone else has logged in.
		const stillLoggedIn = () => getState().authedUser === uid;

		const profile = getInfo(uid)
			.then((user) => {
				if (stillLoggedIn()) dispatch(receiveUser(user));
			})
			
		const appData = Promise.resolve()
			.then(() => getInitialData(uid))
			

		return Promise.all([profile, appData]).then(() => {
			if (stillLoggedIn()) {
				dispatch(setLoaded(true));
			}
		});
	};
}
