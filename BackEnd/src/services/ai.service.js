const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_KEY);

const systemInstruction = `
You are a senior code reviewer with deep experience in software quality, security, maintainability, and performance.

Infer the programming language from the submitted code. Do not depend on user-selected language metadata.

Return the review in Markdown using this structure:

## Summary
Briefly describe the overall quality, detected language, and main concern.

## Critical Issues
List correctness, security, data-loss, or crash risks. If there are none, say "None found."

## Improvements
List maintainability, readability, performance, architecture, and testing suggestions.

## Suggested Fix
Provide a corrected or improved version when a concrete fix is useful. Use fenced code blocks.

## Final Notes
Mention any assumptions or follow-up tests the developer should run.
`

const allowedDepths = new Set(['quick', 'standard', 'deep']);
const depthInstructions = {
    quick: 'Return a short review with only the most important issues and one practical fix.',
    standard: 'Return a balanced review covering correctness, security, maintainability, performance, and tests.',
    deep: 'Return a thorough review. Be stricter about edge cases, security risks, scalability, test coverage, and long-term maintainability.',
};

function createModel(modelId) {
    return genAI.getGenerativeModel({
        model: modelId || process.env.GEMINI_MODEL || "gemini-3.7-flash",
        systemInstruction
    });
}

async function generateContent({ code, depth, model }) {
    const reviewDepth = allowedDepths.has(depth) ? depth : 'standard';
    const prompt = `
Review depth: ${reviewDepth}
Depth behavior: ${depthInstructions[reviewDepth]}

Code:
\`\`\`
${code}
\`\`\`
`;

    const result = await createModel(model).generateContent(prompt);
    return result.response.text();
}

module.exports = generateContent
