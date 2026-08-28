const availableModels = [
    {
        id: 'gemini-3.7-flash',
        name: 'Gemini 3.7 Flash',
        description: 'Best default for production code review quality.'
    },
    {
        id: 'gemini-3.6-flash',
        name: 'Gemini 3.6 Flash',
        description: 'Balanced quality and speed.'
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Fast, lower-latency review mode.'
    }
]

function getModel(modelId) {
    return availableModels.find(model => model.id === modelId) || availableModels[0]
}

module.exports = {
    availableModels,
    getModel
}
