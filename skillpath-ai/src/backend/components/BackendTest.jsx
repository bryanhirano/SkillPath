
import { useState } from "react";
import { testBackendConnection } from "../firebase.jsx";

export default function BackendTest() {
  const [message, setMessage] = useState("");

  const handleTest = async () => {
    setMessage("Connecting...");

    try {
      const result = await testBackendConnection();
      setMessage(result.message);
    } catch (error) {
      setMessage("Connection failed: " + error.message);
    }
  };

  return (
    <div className="container mt-4">
      <button
        className="btn btn-primary"
        onClick={handleTest}
      >
        Test Backend Connection
      </button>

      <p className="mt-3">{message}</p>
    </div>
  );
}
