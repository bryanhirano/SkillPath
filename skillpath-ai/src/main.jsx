import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './components/App'; // Make sure this path matches your folder structure!
import { Provider } from "react-redux";
import { BrowserRouter as Router } from "react-router-dom";

// Import your perfectly fixed store
import { store } from './store'; 

console.log("VITE IS RUNNING MAIN.JSX - The store is:", store);

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
    <Provider store={store}>
        <Router>
            <App />
        </Router>
    </Provider>
);