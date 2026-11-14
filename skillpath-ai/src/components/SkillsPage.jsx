import ResumeSkills from "./ResumeSkills.jsx";

/**
 * Skills page: shows the skills identified in the signed-in user's resume
 * (calls the `identify_resume_skills` Cloud Function via ResumeSkills).
 */
const SkillsPage = () => (
	<div>
		<h2 className="text-center mt-4">My Skills</h2>
		<ResumeSkills />
	</div>
);

export default SkillsPage;
