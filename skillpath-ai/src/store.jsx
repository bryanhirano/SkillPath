import { configureStore } from "@reduxjs/toolkit";
import logger from "./middleware/logger";
import reducer from "./reducers";

export const store = configureStore({
	reducer: reducer,
	// This adds your custom logger while keeping the default middleware (like Thunk)
	middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(logger),
});
