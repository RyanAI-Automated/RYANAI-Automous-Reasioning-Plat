import unittest

from pipeline import run_pipeline


class PipelineTests(unittest.TestCase):
    def test_renames_fields_adds_defaults_and_preserves_input(self):
        records = [{"first": "Ryan", "active": True}]
        result = run_pipeline(
            records,
            {
                "field_mappings": {"first": "name"},
                "defaults": {"region": "local"},
                "required_fields": ["name", "region"],
            },
        )
        self.assertEqual(result, [{"name": "Ryan", "active": True, "region": "local"}])
        self.assertEqual(records, [{"first": "Ryan", "active": True}])

    def test_rejects_missing_required_field(self):
        with self.assertRaisesRegex(ValueError, "Record 0 is missing required fields: id"):
            run_pipeline([{"name": "Ryan"}], {"required_fields": ["id"]})

    def test_rejects_non_object_record(self):
        with self.assertRaisesRegex(ValueError, "Each record must be a JSON object"):
            run_pipeline([None])


if __name__ == "__main__":
    unittest.main()
