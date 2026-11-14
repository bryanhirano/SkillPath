#!/usr/bin/env python3
"""Look up O*NET job titles and retrieve structured occupation profiles."""

import argparse
import csv
import json
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen
from dotenv import load_dotenv

load_dotenv()


DATA_DIR = Path(__file__).with_name("data")
CSV_PATH = DATA_DIR / "occupation_data.csv"
API_BASE_URL = "https://api-v2.onetcenter.org/online/occupations"
SOC_CODE_COLUMN = "O*NET-SOC Code"
TITLE_COLUMNS = ("Title",)
PROFILE_SECTIONS = (
    "education",
    "detailed_work_activities",
    "skills",
    "knowledge",
    "tasks",
    "technology_skills",
)
PROFILE_COLLECTION_KEYS = {
    "education": "response",
    "detailed_work_activities": "activity",
    "skills": "element",
    "knowledge": "element",
    "tasks": "task",
    "technology_skills": "category",
}
SOC_CODE_PATTERN = re.compile(r"\d{2}-\d{4}\.\d{2}")


@dataclass(slots=True)
class EducationEntry:
    """Education level and the percentage of respondents reporting it."""

    title: str
    percentage_of_respondents: int


@dataclass(slots=True)
class WorkActivity:
    """A detailed activity associated with an occupation."""

    title: str


@dataclass(slots=True)
class Skill:
    """A skill, its description, and its O*NET importance score."""

    name: str
    description: str
    importance: int


@dataclass(slots=True)
class Knowledge:
    """A knowledge area, its description, and its O*NET importance score."""

    name: str
    description: str
    importance: int


@dataclass(slots=True)
class Task:
    """An occupation task with its importance and category."""

    title: str
    importance: int
    category: str


@dataclass(slots=True)
class TechnologyExample:
    """A technology example and whether O*NET marks it as hot technology."""

    title: str
    hot_technology: bool


@dataclass(slots=True)
class TechnologyCategory:
    """A technology category and its example technologies."""

    category: str
    examples: list[TechnologyExample] = field(default_factory=list)


@dataclass(slots=True)
class OccupationProfile:  # pylint: disable=too-many-instance-attributes
    """Profile metadata and directly accessible O*NET section lists."""

    soc_code: str
    occupation_title: str | None
    source: str
    education: list[EducationEntry] = field(default_factory=list)
    detailed_work_activities: list[WorkActivity] = field(default_factory=list)
    skills: list[Skill] = field(default_factory=list)
    knowledge: list[Knowledge] = field(default_factory=list)
    tasks: list[Task] = field(default_factory=list)
    technology_skills: list[TechnologyCategory] = field(default_factory=list)


class OnetApiError(RuntimeError):
    """An HTTP error returned by O*NET Web Services."""

    def __init__(self, status_code: int, url: str) -> None:
        """Create an API error with the HTTP status and request URL."""
        super().__init__(f"O*NET API request failed with HTTP {status_code}: {url}")
        self.status_code = status_code


def _normalize_title(title: str) -> str:
    """Normalize a title for case- and whitespace-insensitive matching."""
    return " ".join(title.split()).casefold()


def _section_items(response: dict, section: str) -> list[dict]:
    """Extract the expected list of records from a section response."""
    collection_key = PROFILE_COLLECTION_KEYS[section]
    items = response.get(collection_key)
    if not isinstance(items, list):
        raise ValueError(
            f"Unexpected O*NET response for {section}: "
            f"missing '{collection_key}' collection"
        )

    records = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError(f"Unexpected O*NET item in {section}: expected an object")
        records.append(item)
    return records


def _required_string(item: dict, key: str, section: str) -> str:
    """Return a required string field or report an invalid API item."""
    value = item.get(key)
    if not isinstance(value, str):
        raise ValueError(f"Unexpected O*NET item in {section}: missing '{key}'")
    return value


def _required_integer(item: dict, key: str, section: str) -> int:
    """Return a required integer field or report an invalid API item."""
    value = item.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"Unexpected O*NET item in {section}: missing '{key}'")
    return value


def _normalize_education(response: dict) -> list[EducationEntry]:
    """Convert O*NET education records to typed entries."""
    return [
        EducationEntry(
            title=_required_string(item, "title", "education"),
            percentage_of_respondents=_required_integer(
                item, "percentage_of_respondents", "education"
            ),
        )
        for item in _section_items(response, "education")
    ]


def _normalize_work_activities(response: dict) -> list[WorkActivity]:
    """Convert O*NET work activities to typed entries."""
    return [
        WorkActivity(title=_required_string(item, "title", "detailed_work_activities"))
        for item in _section_items(response, "detailed_work_activities")
    ]


def _normalize_skills(response: dict) -> list[Skill]:
    """Convert O*NET skill records to typed entries."""
    return [
        Skill(
            name=_required_string(item, "name", "skills"),
            description=_required_string(item, "description", "skills"),
            importance=_required_integer(item, "importance", "skills"),
        )
        for item in _section_items(response, "skills")
    ]


def _normalize_knowledge(response: dict) -> list[Knowledge]:
    """Convert O*NET knowledge records to typed entries."""
    return [
        Knowledge(
            name=_required_string(item, "name", "knowledge"),
            description=_required_string(item, "description", "knowledge"),
            importance=_required_integer(item, "importance", "knowledge"),
        )
        for item in _section_items(response, "knowledge")
    ]


def _normalize_tasks(response: dict) -> list[Task]:
    """Convert O*NET task records to typed entries."""
    return [
        Task(
            title=_required_string(item, "title", "tasks"),
            importance=_required_integer(item, "importance", "tasks"),
            category=_required_string(item, "category", "tasks"),
        )
        for item in _section_items(response, "tasks")
    ]


def _normalize_technology_skills(response: dict) -> list[TechnologyCategory]:
    """Convert technology categories and examples to typed entries."""
    categories = []
    for item in _section_items(response, "technology_skills"):
        title = _required_string(item, "title", "technology_skills")
        examples = []
        for example_key in ("example", "example_more"):
            category_examples = item.get(example_key, [])
            if not isinstance(category_examples, list):
                raise ValueError(
                    f"Unexpected O*NET technology_skills item: "
                    f"'{example_key}' must be a list"
                )
            for example in category_examples:
                if not isinstance(example, dict):
                    raise ValueError("Unexpected O*NET technology example")
                hot_technology = example.get("hot_technology", False)
                if not isinstance(hot_technology, bool):
                    raise ValueError(
                        "Unexpected O*NET technology example: "
                        "'hot_technology' must be a boolean"
                    )
                examples.append(
                    TechnologyExample(
                        title=_required_string(
                            example, "title", "technology_skills"
                        ),
                        hot_technology=hot_technology,
                    )
                )
        categories.append(TechnologyCategory(category=title, examples=examples))
    return categories


class JobEngine:
    """Look up O*NET occupations and retrieve their detailed API profile."""

    def __init__(
        self,
        job_titles_path: Path = CSV_PATH,
        api_key: str | None = None,
    ) -> None:
        """Set the local title data source and O*NET API key."""
        self.job_titles_path = Path(job_titles_path)
        self.api_key = api_key or os.environ.get("ONET_API_KEY")

    @staticmethod
    def _validate_title_columns(reader: csv.DictReader, csv_path: Path) -> None:
        """Require the title and SOC-code columns in the CSV header."""
        if reader.fieldnames is None:
            raise ValueError(f"{csv_path} does not contain a CSV header")
        missing_columns = {SOC_CODE_COLUMN, *TITLE_COLUMNS}.difference(
            reader.fieldnames
        )
        if missing_columns:
            raise ValueError(
                f"{csv_path} is missing required columns: "
                f"{', '.join(sorted(missing_columns))}"
            )

    def find_onet_soc_codes(self, job_title: str) -> list[str]:
        """Return unique exact title matches, ignoring case and extra spaces."""
        normalized_title = _normalize_title(job_title)
        if not normalized_title:
            return []

        codes: set[str] = set()
        with self.job_titles_path.open(
            "r", encoding="utf-8-sig", newline=""
        ) as csv_file:
            reader = csv.DictReader(csv_file)
            self._validate_title_columns(reader, self.job_titles_path)

            for row in reader:
                if any(
                    _normalize_title(row[column] or "") == normalized_title
                    for column in TITLE_COLUMNS
                ):
                    code = (row[SOC_CODE_COLUMN] or "").strip()
                    if code:
                        codes.add(code)

        return sorted(codes)

    def _request_json(self, url: str) -> dict:
        """Send an authenticated O*NET request and decode its JSON response."""
        if not self.api_key:
            raise RuntimeError(
                "O*NET API key is required. Set the ONET_API_KEY environment "
                "variable; obtain a key from the O*NET Web Services developer site."
            )

        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "job-engine/1.0",
                "X-API-Key": self.api_key,
            },
        )
        for attempt in range(3):
            try:
                with urlopen(request, timeout=30) as response:
                    data = json.loads(response.read().decode("utf-8"))
                if not isinstance(data, dict):
                    raise ValueError(f"O*NET API returned a non-object response: {url}")
                return data
            except HTTPError as error:
                if error.code == 429 and attempt < 2:
                    time.sleep(0.25 * (2**attempt))
                    continue
                raise OnetApiError(error.code, url) from error
            except URLError as error:
                raise RuntimeError(f"Could not reach the O*NET API: {error.reason}") from error
            except json.JSONDecodeError as error:
                raise RuntimeError(f"O*NET API returned invalid JSON: {url}") from error

        raise RuntimeError(f"O*NET API request failed after retries: {url}")

    def _get_section(self, section_url: str) -> dict:
        """Fetch all pages of an O*NET profile section."""
        result = self._request_json(section_url)
        list_keys = [key for key, value in result.items() if isinstance(value, list)]
        if not list_keys:
            return result
        if len(list_keys) != 1:
            raise ValueError(
                f"Unexpected O*NET API response with multiple collections: "
                f"{section_url}"
            )

        item_key = list_keys[0]
        items = list(result[item_key])
        next_url = result.get("next")
        section_path = urlsplit(section_url).path
        while next_url:
            parts = urlsplit(next_url)
            if (
                parts.scheme != "https"
                or parts.hostname != "api-v2.onetcenter.org"
                or parts.path != section_path
            ):
                raise ValueError(f"Unexpected O*NET pagination URL: {next_url}")
            page = self._request_json(next_url)
            page_items = page.get(item_key)
            if not isinstance(page_items, list):
                raise ValueError(
                    f"Unexpected paginated O*NET response for {section_url}"
                )
            items.extend(page_items)
            next_url = page.get("next")

        result[item_key] = items
        result.pop("next", None)
        result["end"] = len(items)
        return result

    def get_occupation_profile(self, soc_code: str) -> OccupationProfile:
        """Fetch all documented occupation detail sections for a SOC code."""
        normalized_code = soc_code.strip()
        if not SOC_CODE_PATTERN.fullmatch(normalized_code):
            raise ValueError(
                f"Invalid O*NET-SOC code '{soc_code}'; expected format NN-NNNN.NN."
            )
        if not self.api_key:
            raise RuntimeError(
                "O*NET API key is required. Set the ONET_API_KEY environment "
                "variable; obtain a key from the O*NET Web Services developer site."
            )

        encoded_code = quote(normalized_code, safe="-.")
        base_url = f"{API_BASE_URL}/{encoded_code}/details"
        occupation_title = self._get_occupation_title(normalized_code)
        section_responses: dict[str, dict] = {}
        for section in PROFILE_SECTIONS:
            url = f"{base_url}/{section}"
            try:
                section_responses[section] = self._get_section(url)
            except OnetApiError as error:
                if error.status_code == 404 and section != "skills":
                    section_responses[section] = {
                        PROFILE_COLLECTION_KEYS[section]: []
                    }
                    continue
                raise

        return OccupationProfile(
            soc_code=normalized_code,
            occupation_title=occupation_title,
            source="O*NET Web Services API Version 2.0",
            education=_normalize_education(section_responses["education"]),
            detailed_work_activities=_normalize_work_activities(
                section_responses["detailed_work_activities"]
            ),
            skills=_normalize_skills(section_responses["skills"]),
            knowledge=_normalize_knowledge(section_responses["knowledge"]),
            tasks=_normalize_tasks(section_responses["tasks"]),
            technology_skills=_normalize_technology_skills(
                section_responses["technology_skills"]
            ),
        )

    def _get_occupation_title(self, soc_code: str) -> str | None:
        """Find the local occupation title for an O*NET-SOC code."""
        with self.job_titles_path.open(
            "r", encoding="utf-8-sig", newline=""
        ) as csv_file:
            reader = csv.DictReader(csv_file)
            self._validate_title_columns(reader, self.job_titles_path)
            for row in reader:
                if (row[SOC_CODE_COLUMN] or "").strip() == soc_code:
                    return (row["Title"] or "").strip() or None
        return None


def main() -> int:
    """Run the command-line lookup and print the occupation profile."""
    parser = argparse.ArgumentParser(
        description="Find a job title's O*NET-SOC code and retrieve its full profile."
    )
    parser.add_argument("job_title", help="Exact job title to look up")
    parser.add_argument(
        "--csv",
        type=Path,
        default=CSV_PATH,
        help=f"Job-title CSV (default: {CSV_PATH.relative_to(Path(__file__).parent)})",
    )
    args = parser.parse_args()

    engine = JobEngine(job_titles_path=args.csv)
    codes = engine.find_onet_soc_codes(args.job_title)
    if not codes:
        print(f"No O*NET-SOC code found for '{args.job_title}'.", file=sys.stderr)
        return 1
    if len(codes) > 1:
        print(
            f"'{args.job_title}' matches multiple O*NET-SOC codes: "
            f"{', '.join(codes)}. Using the lowest code, {codes[0]}.",
            file=sys.stderr,
        )

    try:
        profile = engine.get_occupation_profile(codes[0])
    except (RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1

    print(json.dumps(asdict(profile), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
