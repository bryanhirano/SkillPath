import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { _signOut, subscribeToResumeStatus } from "../backend/firebase"; // Adjust path if needed

// Pages in the order a user works through them.
const RESUME_ONLY_PAGES = [{ to: "/resume", label: "My Resume" }];
const ALL_PAGES = [
	{ to: "/resume", label: "My Resume" },
	{ to: "/dashboard", label: "Dashboard" },
	{ to: "/skills", label: "Skills & Target Job" },
	{ to: "/training", label: "Training Plan" },
];

const Toolbar = () => {
	const [hasResume, setHasResume] = useState(false);
	const pages = hasResume ? ALL_PAGES : RESUME_ONLY_PAGES;

	const navigate = useNavigate();
	// The menu is collapsed into a button on small screens.
	const [open, setOpen] = useState(false);
	const close = () => setOpen(false);

	const handleSignOut = () => {
		close();
		_signOut().then(() => {
			navigate("/login");
		});
	};

	// Runs once when the toolbar mounts. After that, setHasResume is called
	// only when the resume status changes (upload, typed save, delete,
	// sign-in/out) - not on every render.
	useEffect(() => subscribeToResumeStatus(setHasResume), []);

	// app-toolbar (layout.css) keeps the bar at the top while the page scrolls.
	return (
		<nav className="app-toolbar navbar navbar-expand-lg navbar-dark bg-primary shadow-sm mb-4">
			<div className="container-fluid">
				{/* Brand Logo / Home Link */}
				<Link
					className="navbar-brand fw-bold"
					to={hasResume ? "/dashboard" : "/resume"}
					onClick={close}
				>
					SkillPath
				</Link>

				{/* Mobile Toggle Button */}
				<button
					className="navbar-toggler"
					type="button"
					aria-controls="navbarContent"
					aria-expanded={open}
					aria-label="Toggle navigation"
					onClick={() => setOpen((o) => !o)}
				>
					<span className="navbar-toggler-icon"></span>
				</button>

				{/* Navigation Links and Actions */}
				<div
					className={`collapse navbar-collapse ${open ? "show" : ""}`}
					id="navbarContent"
				>
					<ul className="navbar-nav me-auto mb-2 mb-lg-0">
						{pages.map((page) => (
							<li className="nav-item" key={page.to}>
								<NavLink
									className={({ isActive }) =>
										`nav-link ${isActive ? "active fw-semibold" : ""}`
									}
									to={page.to}
									onClick={close}
								>
									{page.label}
								</NavLink>
							</li>
						))}
					</ul>

					<div className="d-flex">
						<button
							type="button"
							onClick={handleSignOut}
							className="btn btn-outline-light"
						>
							Sign out
						</button>
					</div>
				</div>
			</div>
		</nav>
	);
};

export default Toolbar;