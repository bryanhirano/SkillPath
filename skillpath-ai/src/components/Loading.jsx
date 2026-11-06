const Loading = () => (
	<div className="w-100 min-vh-100 d-flex align-items-center justify-content-center">
		<div
			className="spinner-border"
			style={{ color: "#7494EA", width: "100px", height: "100px" }}
			role="status"
		>
			<span className="visually-hidden">Loading...</span>
		</div>
	</div>
);

export default Loading;
