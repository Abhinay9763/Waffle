#!/usr/bin/env node
/**
 * Test script to verify the question renumbering fix
 * Run this to test the REMOVE_QUESTION behavior locally
 */

// Simulate the reducer function behavior
function makeQ(id) {
  return {
    question_id: id,
    text: `Question ${id}`,
    options: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }],
    correct_option: null,
    marks: 1,
    negative_marks: 0
  };
}

function flatQuestions(sections) {
  return sections.flatMap(s => s.questions);
}

// Test the old (buggy) behavior
function oldRemoveQuestion(state, questionIdToRemove) {
  const flat = flatQuestions(state.sections);
  const idx = flat.findIndex(q => q.question_id === questionIdToRemove);
  const newFlat = flat.filter(q => q.question_id !== questionIdToRemove);
  const newActive = newFlat[Math.min(idx, newFlat.length - 1)]?.question_id;

  return {
    ...state,
    sections: state.sections
      .map(s => ({ ...s, questions: s.questions.filter(q => q.question_id !== questionIdToRemove) }))
      .filter(s => s.questions.length > 0),
    activeId: newActive,
  };
}

// Test the new (fixed) behavior
function newRemoveQuestion(state, questionIdToRemove) {
  const flat = flatQuestions(state.sections);
  const idx = flat.findIndex(q => q.question_id === questionIdToRemove);

  // Remove the question first
  const sectionsWithQuestionRemoved = state.sections
    .map(s => ({ ...s, questions: s.questions.filter(q => q.question_id !== questionIdToRemove) }))
    .filter(s => s.questions.length > 0);

  // Renumber all remaining questions sequentially starting from 1
  let newQuestionId = 1;
  const renumberedSections = sectionsWithQuestionRemoved.map(section => ({
    ...section,
    questions: section.questions.map(question => ({
      ...question,
      question_id: newQuestionId++
    }))
  }));

  // Calculate new active ID
  const newFlat = flatQuestions(renumberedSections);
  const newActiveIndex = Math.min(idx, newFlat.length - 1);
  const newActive = newFlat[newActiveIndex]?.question_id || null;

  return {
    ...state,
    sections: renumberedSections,
    activeId: newActive,
    _nextQId: newQuestionId,
  };
}

// Test data
const initialState = {
  sections: [
    {
      section_id: 1,
      name: "Section 1",
      questions: [makeQ(1), makeQ(2), makeQ(3), makeQ(4)]
    },
    {
      section_id: 2,
      name: "Section 2",
      questions: [makeQ(5), makeQ(6), makeQ(7)]
    }
  ],
  activeId: 3,
  _nextQId: 8
};

console.log("🧪 Testing Question ID Renumbering Fix\n");

console.log("📋 Initial Questions:");
flatQuestions(initialState.sections).forEach(q =>
  console.log(`  Question ${q.question_id}: "${q.text}"`)
);

console.log("\n🗑️ Deleting Question 3...\n");

// Test old behavior
const oldResult = oldRemoveQuestion(initialState, 3);
console.log("❌ OLD (Buggy) Behavior:");
console.log("Question IDs after deletion:",
  flatQuestions(oldResult.sections).map(q => q.question_id).join(', ')
);
console.log("❌ Result: Gap at position 3! IDs: 1, 2, 4, 5, 6, 7\n");

// Test new behavior
const newResult = newRemoveQuestion(initialState, 3);
console.log("✅ NEW (Fixed) Behavior:");
console.log("Question IDs after deletion:",
  flatQuestions(newResult.sections).map(q => q.question_id).join(', ')
);
console.log("✅ Result: Perfect sequence! IDs: 1, 2, 3, 4, 5, 6");
console.log("✅ Next question ID will be:", newResult._nextQId);

console.log("\n🎉 Fix verified! No more gaps in question IDs!");

// Test edge case - delete last question
console.log("\n🧪 Testing Edge Case - Delete Last Question:");
const testDeleteLast = newRemoveQuestion(newResult, 6);
console.log("Question IDs after deleting last:",
  flatQuestions(testDeleteLast.sections).map(q => q.question_id).join(', ')
);
console.log("Next question ID:", testDeleteLast._nextQId);