/**
 * Full-page loading screen, shared by the upload page and the dashboard
 * so moving from one to the other looks like a single loading step.
 */
const Loading = ({ title = "Loading…", detail }) => (
	<div
		className="container d-flex flex-column justify-content-center align-items-center text-center"
		style={{ minHeight: "60vh" }}
		role="status"
		aria-live="polite"
	>
		<div
			className="spinner-border text-primary mb-3"
			style={{ width: "3rem", height: "3rem" }}
			aria-hidden="true"
		/>
		<h4 className="mb-1">{title}</h4>
		{detail && <p className="text-muted mb-0">{detail}</p>}
	</div>
);

export default Loading;