from openai import OpenAI

client = OpenAI(
    base_url='http://localhost:11434/v1/',
    apiKey='ollama',  # required but ignored for local server usage
)

chat_completion = client.chat.completions.create(
    messages=[
        {
            'role': 'user',
            'content': 'Say this is a test',
        }
    ],
    model='gpt-oss:20b',
)
print(chat_completion.choices[0].message.content)