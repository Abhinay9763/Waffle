#!/usr/bin/env node
/**
 * Test script to verify question IDs are correctly exported to JSON
 * This simulates the complete flow: state → reducer → buildPayload → JSON
 */

// Simulate the exact buildPayload function from PaperBuilder.tsx
function buildPayload(state) {
  const flat = state.sections.flatMap(s => s.questions);
  const totalMarks = flat.reduce((sum, q) => sum + q.marks, 0);

  const questions = {
    meta: { exam_name: state.examName, total_marks: totalMarks },
    sections: state.sections.map(s => ({
      section_id: s.section_id,
      name: s.name,
      questions: s.questions.map(q => ({
        question_id: q.question_id,  // ← This uses the renumbered IDs
        text: q.text,
        image_url: q.image_url,
        options: q.options,
        marks: q.marks,
        negative_marks: q.negative_marks,
      })),
    })),
  };

  const answers = {};
  for (const q of flat) {
    if (q.correct_option !== null) answers[q.question_id] = q.correct_option;
  }

  return { questions, answers };
}

// Simulate the REMOVE_QUESTION reducer logic
function removeQuestionWithRenumbering(state, questionIdToRemove) {
  const flat = state.sections.flatMap(s => s.questions);
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
      question_id: newQuestionId++  // ← Sequential renumbering
    }))
  }));

  return {
    ...state,
    sections: renumberedSections,
    _nextQId: newQuestionId,
  };
}

// Test data - your Java exam scenario
const initialState = {
  examName: "Test Java Exam",
  sections: [
    {
      section_id: 1,
      name: "Core",
      questions: [
        { question_id: 1, text: "Q1", options: [{text:"A"}, {text:"B"}, {text:"C"}, {text:"D"}], marks: 1, negative_marks: 0, correct_option: 0 },
        { question_id: 2, text: "Q2", options: [{text:"A"}, {text:"B"}, {text:"C"}, {text:"D"}], marks: 1, negative_marks: 0, correct_option: 1 },
        { question_id: 3, text: "Q3", options: [{text:"A"}, {text:"B"}, {text:"C"}, {text:"D"}], marks: 1, negative_marks: 0, correct_option: 2 },
        { question_id: 4, text: "Q4", options: [{text:"A"}, {text:"B"}, {text:"C"}, {text:"D"}], marks: 1, negative_marks: 0, correct_option: 3 },
      ]
    },
    {
      section_id: 2,
      name: "Advanced",
      questions: [
        { question_id: 5, text: "Q5", options: [{text:"A"}, {text:"B"}, {text:"C"}, {text:"D"}], marks: 1, negative_marks: 0, correct_option: 0 },
        { question_id: 6, text: "Q6", options: [{text:"A"}, {text:"B"}, {text:"C"}, {text:"D"}], marks: 1, negative_marks: 0, correct_option: 1 },
        { question_id: 7, text: "Q7", options: [{text:"A"}, {text:"B"}, {text:"C"}, {text:"D"}], marks: 1, negative_marks: 0, correct_option: 2 },
      ]
    }
  ],
  _nextQId: 8
};

console.log("🧪 Testing JSON Export with Question ID Renumbering\n");

console.log("📋 BEFORE Deletion:");
const initialPayload = buildPayload(initialState);
const initialQuestionIds = initialPayload.questions.sections.flatMap(s => s.questions.map(q => q.question_id));
console.log("Question IDs in JSON:", initialQuestionIds.join(', '));
console.log("Answer keys:", JSON.stringify(initialPayload.answers));

console.log("\n🗑️ Deleting Question 3...\n");

// Apply the REMOVE_QUESTION reducer
const stateAfterDeletion = removeQuestionWithRenumbering(initialState, 3);

console.log("📋 AFTER Deletion & Renumbering:");
const finalPayload = buildPayload(stateAfterDeletion);
const finalQuestionIds = finalPayload.questions.sections.flatMap(s => s.questions.map(q => q.question_id));

console.log("Question IDs in JSON:", finalQuestionIds.join(', '));
console.log("Answer keys:", JSON.stringify(finalPayload.answers));

console.log("\n🔍 JSON Export Verification:");
console.log("❌ Expected (if IDs weren't renumbered):", "1, 2, 4, 5, 6, 7");
console.log("✅ Actual (with renumbering):", finalQuestionIds.join(', '));

// Check if the JSON has sequential IDs
const isSequential = finalQuestionIds.every((id, index) => id === index + 1);
console.log(`\n${isSequential ? '✅' : '❌'} JSON has sequential question IDs:`, isSequential);

console.log("\n📄 Sample JSON Output:");
console.log(JSON.stringify(finalPayload.questions, null, 2));