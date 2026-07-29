import ast
import json
import sys

def parse_fastapi(source_code, file_path):
    routes = []
    diagnostics = []
    units = []

    try:
        tree = ast.parse(source_code, filename=file_path)
    except SyntaxError as e:
        diagnostics.append({
            "file": file_path,
            "line": e.lineno,
            "message": f"SyntaxError: {e.msg}"
        })
        return units, routes, diagnostics
    except Exception as e:
        diagnostics.append({
            "file": file_path,
            "line": 0,
            "message": f"Error: {str(e)}"
        })
        return units, routes, diagnostics

    # Simple AST visitor
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # We want to check decorators
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Call):
                    func = decorator.func
                    # looking for @app.get('/path') or similar
                    if isinstance(func, ast.Attribute):
                        method = func.attr
                        
                        if method in ('get', 'post', 'put', 'patch', 'delete', 'api_route'):
                            route_path = None
                            if decorator.args:
                                if isinstance(decorator.args[0], ast.Constant):
                                    route_path = decorator.args[0].value
                                elif isinstance(decorator.args[0], ast.Str):
                                    route_path = decorator.args[0].s
                            
                            status_code = None
                            response_model = None
                            for kw in decorator.keywords:
                                if kw.arg == 'status_code':
                                    if hasattr(ast, 'Constant') and isinstance(kw.value, getattr(ast, 'Constant')):
                                        status_code = kw.value.value
                                    elif isinstance(kw.value, ast.Num):
                                        status_code = kw.value.n
                                elif kw.arg == 'response_model':
                                    if isinstance(kw.value, ast.Name):
                                        response_model = kw.value.id
                                    elif isinstance(kw.value, ast.Attribute):
                                        response_model = kw.value.attr
                            
                            # dependencies from Depends() in signature
                            dependencies = []
                            request_model = None
                            
                            for arg in node.args.args:
                                # request model annotations
                                if arg.annotation:
                                    if isinstance(arg.annotation, ast.Name):
                                        request_model = arg.annotation.id
                                    elif isinstance(arg.annotation, ast.Attribute):
                                        request_model = arg.annotation.attr
                            
                            # check defaults for Depends
                            for default in node.args.defaults:
                                if isinstance(default, ast.Call):
                                    if isinstance(default.func, ast.Name) and default.func.id == 'Depends':
                                        if default.args and isinstance(default.args[0], ast.Name):
                                            dependencies.append(default.args[0].id)
                            
                            routes.append({
                                "file": file_path,
                                "lineStart": node.lineno,
                                "path": route_path,
                                "methods": [method.upper()] if method != 'api_route' else None, # Might need to parse methods from kwargs for api_route
                                "dependencies": dependencies,
                                "requestModel": request_model,
                                "responseModel": response_model,
                                "statusCode": status_code,
                                "exceptionHandler": None
                            })
                            
                        elif method == 'exception_handler':
                            exc_handler = None
                            if decorator.args:
                                if hasattr(ast, 'Constant') and isinstance(decorator.args[0], getattr(ast, 'Constant')):
                                    exc_handler = str(decorator.args[0].value)
                                elif isinstance(decorator.args[0], ast.Num):
                                    exc_handler = str(decorator.args[0].n)
                                elif isinstance(decorator.args[0], ast.Str):
                                    exc_handler = decorator.args[0].s
                                elif isinstance(decorator.args[0], ast.Name):
                                    exc_handler = decorator.args[0].id
                            
                            routes.append({
                                "file": file_path,
                                "lineStart": node.lineno,
                                "path": None,
                                "methods": None,
                                "dependencies": [],
                                "requestModel": None,
                                "responseModel": None,
                                "statusCode": None,
                                "exceptionHandler": exc_handler
                            })

    return units, routes, diagnostics

def main():
    input_data = sys.stdin.read()
    if not input_data:
        return
        
    try:
        data = json.loads(input_data)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON input"}))
        return

    all_units = []
    all_routes = []
    all_diagnostics = []

    files = data.get("files", [])
    for f in files:
        file_path = f.get("path")
        source = f.get("source")
        if file_path and source:
            units, routes, diagnostics = parse_fastapi(source, file_path)
            all_units.extend(units)
            all_routes.extend(routes)
            all_diagnostics.extend(diagnostics)

    output = {
        "units": all_units,
        "routes": all_routes,
        "diagnostics": all_diagnostics
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()
