import { getInfo } from "./firebase.jsx";


export function getInitialData (uid) {
  return Promise.all([
    getInfo(uid),
   
  ]).then(() => ({
    

  }))
}

