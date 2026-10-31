import { configureStore } from "@reduxjs/toolkit";
import reducer from "./reducers"; 
import logger from "./middleware/logger"; 

export const store = configureStore({
  reducer: reducer,
  // This adds your custom logger while keeping the default middleware (like Thunk)
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(logger),
});