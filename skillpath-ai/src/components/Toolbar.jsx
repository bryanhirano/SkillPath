import { Link, useNavigate } from "react-router-dom";
import { _signOut } from "../backend/firebase"; // Adjust path if needed

const Toolbar = () => {
  const navigate = useNavigate();

  const handleSignOut = () => {
    _signOut().then(() => {
      navigate("/login");
    });
  };

  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-primary shadow-sm mb-4">
      <div className="container-fluid">
        {/* Brand Logo / Home Link */}
        <Link className="navbar-brand fw-bold" to="/">
          SkillPath
        </Link>
        
        {/* Mobile Toggle Button */}
        <button 
          className="navbar-toggler" 
          type="button" 
          data-bs-toggle="collapse" 
          data-bs-target="#navbarContent"
        >
          <span className="navbar-toggler-icon"></span>
        </button>
        
        {/* Navigation Links and Actions */}
        <div className="collapse navbar-collapse" id="navbarContent">
          <ul className="navbar-nav me-auto mb-2 mb-lg-0">
            <li className="nav-item">
              <Link className="nav-link" to="/resume">My Resume</Link>
            </li>
          </ul>
          
          <div className="d-flex">
            <button onClick={handleSignOut} className="btn btn-outline-light">
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Toolbar;