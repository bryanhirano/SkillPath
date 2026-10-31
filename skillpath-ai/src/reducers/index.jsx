import { combineReducers } from 'redux'
import authedUser from './authedUser'
import loaded from './loaded'
import user from './user'



export default combineReducers({
   
    authedUser,
    user,
    loaded,  
})