import unittest

from pydantic import ValidationError

from app.api.walkthrough import from_solution
from app.video.geometry import Diagram, is_geometry_task
from app.video.worked_geometry import WORKED, worked_geometry


class GeometryDiagramTests(unittest.TestCase):
    def test_reviewed_bank_samples_satisfy_the_construction(self):
        for ref in WORKED:
            with self.subTest(ref=ref):
                data = worked_geometry(ref)
                diagram = Diagram.model_validate(data['diagram'])
                self.assertTrue(diagram.edges)
                self.assertTrue(all(s['explanation'] for s in data['steps']))

    def test_an_incorrect_given_angle_cannot_pass(self):
        data = worked_geometry('g16.1')['diagram']
        angle = next(r for r in data['relations'] if r['kind'] == 'angle')
        angle['value'] = 45
        with self.assertRaisesRegex(ValidationError, 'angle'):
            Diagram.model_validate(data)

    def test_a_false_tangency_cannot_pass(self):
        diagram = {
            'dimension': 2,
            'points': {'O': [0, 0, 0], 'T': [1, 0, 0], 'A': [-3, 3, 0], 'B': [3, 3, 0]},
            'edges': [{'points': ['A', 'B']}],
            'circles': [{'center': 'O', 'through': 'T'}],
            'relations': [{'kind': 'tangent', 'points': ['O', 'T', 'A', 'B']}],
        }
        with self.assertRaisesRegex(ValidationError, 'tangent'):
            Diagram.model_validate(diagram)

    def test_task_numbers_are_exam_specific(self):
        self.assertTrue(is_geometry_task('prof', 14))
        self.assertFalse(is_geometry_task('base', 14))
        self.assertTrue(is_geometry_task('oge', 24))

    def test_perpendicular_segments_may_share_a_vertex(self):
        data = {
            'dimension': 3,
            'points': {'A': [1, 0, 0], 'B': [0, 0, 0], 'C': [0, 0, 1]},
            'edges': [{'points': ['A', 'B']}, {'points': ['B', 'C']}],
            'relations': [{'kind': 'perpendicular', 'points': ['A', 'B', 'C']}],
        }
        self.assertEqual(Diagram.model_validate(data).relations[0].points, ['A', 'B', 'B', 'C'])

    def test_written_solution_keeps_later_calculations(self):
        text = '\n'.join('Переход с подробными вычислениями. ' * 2 + f'Получили {i}.' for i in range(20))
        steps = from_solution(text, '19')
        self.assertTrue(any('Получили 19.' in s['explanation'] for s in steps[:-1]))
        self.assertEqual(steps[-1]['lines'], ['Ответ: 19'])
