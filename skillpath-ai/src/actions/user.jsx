export const RECEIVE_USER = "RECEIVE_USER";
export const CHANGE_PICTURE = "CHANGE_PICTURE";
export const REGISTER_USER = "REGISTER_USER";
export const UPDATE_USER = "UPDATE_USER"


export function receiveUser(user) {
    return {
        type: RECEIVE_USER,
        user,
    }
}

export function registerUser(userInfo){
    return{
        type: REGISTER_USER,
        userInfo,
    }
}


export function updateUser(userInfo){
    return{
        type: UPDATE_USER,
        userInfo
    }


}
