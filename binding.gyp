{
  "targets": [
    {
      "target_name": "ryan_cuda_engine",
      "sources": [
        "src/inference/cuda_engine.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='win'",
          {
            "include_dirs": [
              "<!@(node -p \"(process.env.CUDA_PATH ? process.env.CUDA_PATH + '/include' : 'C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.0/include').split(String.fromCharCode(92)).join('/')\")"
            ],
            "libraries": [
              "<!@(node -p \"(process.env.CUDA_PATH ? process.env.CUDA_PATH + '/lib/x64/cudart.lib' : 'C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.0/lib/x64/cudart.lib').split(String.fromCharCode(92)).join('/')\")"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "include_dirs": [
              "<!@(node -p \"require('fs').existsSync('/usr/local/cuda/include') ? '/usr/local/cuda/include' : '.'\")"
            ],
            "library_dirs": [
              "<!@(node -p \"require('fs').existsSync('/usr/local/cuda/lib64') ? '/usr/local/cuda/lib64' : ''\")"
            ],
            "libraries": [
              "<!@(node -p \"require('fs').existsSync('/usr/local/cuda/lib64') ? '-lcudart' : ''\")"
            ],
            "cflags_cc": ["-std=c++17", "-frtti"]
          }
        ]
      ]
    }
  ]
}
