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
    }
]

function getModel(modelId) {
    return availableModels.find(model => model.id === modelId) || availableModels[0]
}

module.exports = {
    availableModels,
    getModel
}
