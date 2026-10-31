
import { RECEIVE_USER, UPDATE_USER } from "../actions/user";

export default function user(state = {}, action) {
    switch (action.type) {
        case RECEIVE_USER:
            return {
                ...state,
                ...action.user,
            }

        case UPDATE_USER:
            const {userInfo} = action
            return{
                ...state,
                state:{
                    ...state,
                    ['color']: userInfo.color,
                    ['phone']: userInfo.phone
                }
            }

        default:
            return state;
    }
}